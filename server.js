/**
 * LLM Space - 本地代理服务器
 * 转发请求到 Anthropic 兼容 API，解决浏览器 CORS 限制
 * 支持 SSE 流式输出、extended thinking、工具调用
 */
import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { executeTool, getToolSchemas } from './server/tools/index.js';

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:5174' }));
app.use(express.json({ limit: '4mb' }));

/** 发送 SSE 事件 */
function sendEvent(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

/** 主要代理端点：POST /api/chat */
app.post('/api/chat', async (req, res) => {
  const { messages, system, tools, model, apiKey, baseUrl, temperature, maxTokens, thinkingEnabled } = req.body;

  if (!apiKey) return res.status(400).json({ error: '缺少 API Key' });

  const endpoint = `${(baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;

  // 构建请求体
  const requestBody = {
    model: model || 'claude-sonnet-4-5',
    max_tokens: maxTokens || 8000,
    system: system || '',
    messages,
    stream: true,
  };

  // 工具配置
  if (tools && tools.length > 0) {
    requestBody.tools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters || {}).map(([k, v]) => [k, { type: v.type || 'string', description: v.description || '' }])
        ),
        required: Object.entries(t.parameters || {}).filter(([, v]) => v.required).map(([k]) => k),
      },
    }));
  }

  // Extended Thinking（Claude 3.7+ / claude-sonnet-4-5+）
  if (thinkingEnabled) {
    requestBody.thinking = { type: 'enabled', budget_tokens: Math.min(maxTokens * 0.6 || 5000, 10000) };
    // thinking 模式下温度必须为 1
    requestBody.temperature = 1;
    requestBody.betas = ['interleaved-thinking-2025-05-07'];
  } else if (temperature !== undefined) {
    requestBody.temperature = temperature;
  }

  try {
    const isDeepSeek = endpoint.includes('deepseek.com');
    
    // DeepSeek API 不支持 Anthropic 的 thinking beta
    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (thinkingEnabled && !isDeepSeek) {
      reqHeaders['anthropic-beta'] = 'interleaved-thinking-2025-05-07';
    }

    // DeepSeek 不能传 thinking 字段
    if (thinkingEnabled && isDeepSeek) {
      delete requestBody.thinking;
    }

    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(requestBody),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      let errMsg = `API 错误 ${upstream.status}`;
      try { errMsg = JSON.parse(errText)?.error?.message || errMsg; } catch {}
      return res.status(upstream.status).json({ error: errMsg });
    }

    // 成功获取到响应流，设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 当前 content block 状态
    let currentBlockType = null;
    let currentBlockIndex = null;
    let thinkingText = '';
    let textContent = '';
    let toolName = '';
    let toolInputRaw = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        let evt;
        try { evt = JSON.parse(raw); } catch { continue; }

        switch (evt.type) {
          case 'message_start':
            sendEvent(res, 'message_start', {
              model: evt.message?.model,
              inputTokens: evt.message?.usage?.input_tokens,
            });
            break;

          case 'content_block_start': {
            const blk = evt.content_block;
            currentBlockType = blk.type;
            currentBlockIndex = evt.index;
            if (blk.type === 'thinking') {
              thinkingText = '';
              sendEvent(res, 'thinking_start', { index: evt.index, signature: blk.signature });
            } else if (blk.type === 'text') {
              textContent = '';
              sendEvent(res, 'text_start', { index: evt.index });
            } else if (blk.type === 'tool_use') {
              toolName = blk.name;
              toolInputRaw = '';
              sendEvent(res, 'tool_start', { index: evt.index, name: blk.name, id: blk.id });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = evt.delta;
            if (delta.type === 'thinking_delta') {
              thinkingText += delta.thinking;
              sendEvent(res, 'thinking_delta', { text: delta.thinking });
            } else if (delta.type === 'text_delta') {
              textContent += delta.text;
              sendEvent(res, 'text_delta', { text: delta.text });
            } else if (delta.type === 'input_json_delta') {
              toolInputRaw += delta.partial_json;
              sendEvent(res, 'tool_input_delta', { partial: delta.partial_json });
            }
            break;
          }

          case 'content_block_stop':
            if (currentBlockType === 'thinking') {
              sendEvent(res, 'thinking_end', { text: thinkingText });
            } else if (currentBlockType === 'text') {
              sendEvent(res, 'text_end', { text: textContent });
            } else if (currentBlockType === 'tool_use') {
              let toolInput = {};
              try { toolInput = JSON.parse(toolInputRaw || '{}'); } catch {}
              sendEvent(res, 'tool_end', { name: toolName, input: toolInput });
            }
            currentBlockType = null;
            break;

          case 'message_delta':
            sendEvent(res, 'message_delta', {
              outputTokens: evt.usage?.output_tokens,
              stopReason: evt.delta?.stop_reason,
            });
            if (evt.delta?.stop_reason) {
              sendEvent(res, 'stop', {
                stopReason: evt.delta.stop_reason,
                outputTokens: evt.usage?.output_tokens,
              });
            }
            break;

          case 'error':
            sendEvent(res, 'error', { message: evt.error?.message || '未知错误' });
            break;
        }
      }
    }

    sendEvent(res, 'done', {});
    res.end();
  } catch (err) {
    sendEvent(res, 'error', { message: err.message });
    res.end();
  }
});

const HARNESS_DIR = path.join(process.cwd(), 'harnesses');

/** 获取所有 Harness 文件列表 */
app.get('/api/harnesses', async (req, res) => {
  try {
    await fs.mkdir(HARNESS_DIR, { recursive: true });
    const files = await fs.readdir(HARNESS_DIR);
    const harnesses = [];
    
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      try {
        const data = JSON.parse(content);
        harnesses.push({
          id: data.id,
          name: file,
          description: data.description,
          category: data.category || 'basic'
        });
      } catch (e) {}
    }
    res.json(harnesses.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取单个 Harness 配置 */
app.get('/api/harnesses/:id', async (req, res) => {
  try {
    const files = await fs.readdir(HARNESS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.id === req.params.id) {
        return res.json(data);
      }
    }
    res.status(404).json({ error: 'Harness not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 保存/更新 Harness 配置 */
app.post('/api/harnesses/:id', async (req, res) => {
  try {
    const data = req.body;
    const filename = data.name || `${req.params.id}.json`;
    const targetPath = path.join(HARNESS_DIR, filename);
    await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取后端注册的所有工具 Schema */
app.get('/api/tools', (req, res) => {
  res.json(getToolSchemas());
});

/** 工具执行端点 (支持 SSE 流式返回) */
app.post('/api/execute-tool', async (req, res) => {
  const { toolName, toolInput } = req.body;
  if (!toolName) return res.status(400).json({ error: '缺少 toolName 参数' });

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const finalResult = await executeTool(toolName, toolInput || {}, (chunk) => {
      // 实时推送数据块
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
    });

    // 任务完成后发送结束标记和最终完整结果
    res.write(`data: ${JSON.stringify({ type: 'done', output: finalResult })}\n\n`);
    res.end();
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
    res.end();
  }
});

/** 健康检查 */
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

/** 
 * GET /api/models 
 * 从 .env 读取配置的模型列表
 */
app.get('/api/models', async (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const envStr = await fs.readFile(envPath, 'utf-8').catch(() => '');
    const match = envStr.match(/^MODELS_CONFIG=(.+)$/m);
    if (match) {
      return res.json(JSON.parse(match[1]));
    }
    return res.json([]);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

/**
 * POST /api/models
 * 添加新的模型配置并写入 .env
 */
app.post('/api/models', async (req, res) => {
  try {
    const newModel = req.body; // { name, url, key, modelId }
    const envPath = path.join(process.cwd(), '.env');
    let envStr = await fs.readFile(envPath, 'utf-8').catch(() => '');
    let models = [];
    
    const match = envStr.match(/^MODELS_CONFIG=(.+)$/m);
    if (match) {
      models = JSON.parse(match[1]);
    }
    
    // 如果没有 id，生成一个
    if (!newModel.id) newModel.id = Date.now().toString();
    
    models.push(newModel);
    const updatedLine = `MODELS_CONFIG=${JSON.stringify(models)}`;
    
    if (match) {
      envStr = envStr.replace(/^MODELS_CONFIG=.*$/m, updatedLine);
    } else {
      envStr += (envStr.endsWith('\n') ? '' : '\n') + updatedLine + '\n';
    }
    
    await fs.writeFile(envPath, envStr, 'utf-8');
    res.json(models);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 LLM Space 代理服务器运行在 http://localhost:${PORT}`);
  console.log(`   前端访问：http://localhost:5174\n`);
});
