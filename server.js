/**
 * LLM Space - 本地代理服务器
 * 转发请求到 Anthropic 兼容 API，解决浏览器 CORS 限制
 * 支持 SSE 流式输出、extended thinking、工具调用
 */
import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getToolSchemas } from './server/tools/index.js';
import { AgentExecutor } from './server/agent/AgentExecutor.js';
import { alignRequestPayload } from './server/agent/messageBuilder.js';

// 加载 .env 文件到 process.env
const dotEnvPath = path.join(process.cwd(), '.env');
try {
  const envContent = await fs.readFile(dotEnvPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('  ✅ .env 已加载');
} catch { console.log('  ⚠️  .env 文件未找到，跳过'); }

// Node.js fetch 不自动读取 HTTPS_PROXY，用 EnvHttpProxyAgent 全局适配
setGlobalDispatcher(new EnvHttpProxyAgent());
console.log('  🔁 代理 agent 已全局启用（自动检测 HTTPS_PROXY / NO_PROXY）');

const app = express();
const PORT = process.env.PORT || 3001;

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

  // 提取目前启用的工具清单并生成后端统一定义的 Schema
  let toolSchemas = [];
  if (tools && tools.length > 0) {
    toolSchemas = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema || {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(t.parameters || {}).map(([k, v]) => [k, { type: v.type || 'string', description: v.description || '' }])
        ),
        required: Object.entries(t.parameters || {}).filter(([, v]) => v.required).map(([k]) => k),
      },
    }));
  }

  // 使用 alignRequestPayload 进行对齐和重排
  const modelConfig = { modelId: model, url: baseUrl || '' };
  const aligned = alignRequestPayload(
    system || '',
    toolSchemas,
    messages || [],
    modelConfig
  );

  // 构建请求体
  const requestBody = {
    model: model || 'claude-sonnet-4-5',
    max_tokens: maxTokens || 8000,
    system: aligned.system || '',
    messages: aligned.messages || [],
    stream: true,
  };

  if (aligned.tools && aligned.tools.length > 0) {
    requestBody.tools = aligned.tools;
  }

  try {
    const isDeepSeek = endpoint.includes('deepseek.com');

    // Extended Thinking
    if (thinkingEnabled) {
      requestBody.thinking = { type: 'enabled', budget_tokens: Math.floor(Math.min(maxTokens * 0.6 || 5000, 10000)) };
      if (!isDeepSeek) {
        requestBody.temperature = 1;
        requestBody.betas = ['interleaved-thinking-2025-05-07'];
      }
    } else if (isDeepSeek) {
      requestBody.thinking = { type: 'disabled' };
      if (temperature !== undefined) requestBody.temperature = temperature;
    } else if (temperature !== undefined) {
      requestBody.temperature = temperature;
    }

    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
    if (thinkingEnabled && !isDeepSeek) {
      reqHeaders['anthropic-beta'] = 'interleaved-thinking-2025-05-07';
    }

    // 带重试的 upstream 请求
    let upstream;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        upstream = await fetch(endpoint, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120000),
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          console.log(`  ⚠️ 请求失败 (attempt ${attempt + 1}/3): ${e.message}，1s 后重试...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    if (!upstream) throw lastErr;

    if (!upstream.ok) {
      const errText = await upstream.text();
      let errMsg = `API 错误 ${upstream.status}`;
      try { errMsg = JSON.parse(errText)?.error?.message || errMsg; } catch { }
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
              cacheReadTokens: evt.message?.usage?.cache_read_input_tokens ?? 0,
              cacheCreationTokens: evt.message?.usage?.cache_creation_input_tokens ?? 0,
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
              try { toolInput = JSON.parse(toolInputRaw || '{}'); } catch { }
              sendEvent(res, 'tool_end', { name: toolName, input: toolInput });
            }
            currentBlockType = null;
            break;

          case 'message_delta':
            sendEvent(res, 'message_delta', {
              inputTokens: evt.usage?.input_tokens,
              outputTokens: evt.usage?.output_tokens,
              cacheReadTokens: evt.usage?.cache_read_input_tokens ?? 0,
              cacheCreationTokens: evt.usage?.cache_creation_input_tokens ?? 0,
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
    console.error(`[ERROR] fetch failed to ${endpoint}: ${err.message} (cause: ${err.cause?.message || 'unknown'})`);
    sendEvent(res, 'error', { message: `网络请求失败: ${err.message} → ${endpoint}` });
    res.end();
  }
});

const HARNESS_DIR = path.join(process.cwd(), 'harnesses');
const SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');

// 自动检测并创建 sessions 目录
fs.mkdir(SESSIONS_DIR, { recursive: true }).catch(err => {
  console.error('[server.js] 自动创建 sessions 目录失败:', err);
});

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
      } catch (e) { }
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

/** 新建 Harness 配置 */
app.post('/api/harnesses', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: '缺少 name 字段' });

    const id = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const filename = `${name}.json`;
    const targetPath = path.join(HARNESS_DIR, filename);

    if (await fs.access(targetPath).then(() => true).catch(() => false)) {
      return res.status(409).json({ error: '同名 Harness 已存在' });
    }

    const harness = {
      id,
      name: filename,
      description: description || '',
      category: 'basic',
      model: {
        name: '',
        response_format: 'text',
        temperature: 1,
        max_tokens: 4096,
        top_p: 1
      },
      tools: [],
      systemPrompt: '',
      skills: []
    };

    await fs.writeFile(targetPath, JSON.stringify(harness, null, 2), 'utf-8');
    res.json({ success: true, harness });
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

/** 删除 Harness 配置 */
app.delete('/api/harnesses/:id', async (req, res) => {
  try {
    const files = await fs.readdir(HARNESS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      try {
        const data = JSON.parse(content);
        if (data.id === req.params.id) {
          await fs.unlink(path.join(HARNESS_DIR, file));
          // 联动删除对应 session 磁盘文件
          const sessionPath = path.join(SESSIONS_DIR, `${req.params.id}.json`);
          await fs.unlink(sessionPath).catch(() => {});
          return res.json({ success: true });
        }
      } catch { }
    }
    res.status(404).json({ error: 'Harness not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 复制 Harness 配置 */
app.post('/api/harnesses/:id/copy', async (req, res) => {
  try {
    const files = await fs.readdir(HARNESS_DIR);
    let source = null;
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      try {
        const data = JSON.parse(content);
        if (data.id === req.params.id) { source = data; break; }
      } catch { }
    }
    if (!source) return res.status(404).json({ error: 'Harness not found' });

    const newId = source.id + '-copy';
    const newName = source.name.replace(/\.json$/, '-copy.json');
    const harness = {
      ...source,
      id: newId,
      name: newName,
      description: (source.description || '') + ' (副本)',
    };
    await fs.writeFile(path.join(HARNESS_DIR, newName), JSON.stringify(harness, null, 2), 'utf-8');
    res.json({ success: true, harness });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const SKILLS_DIR = path.join(process.cwd(), 'skills');

/** 辅助函数：解析 Markdown 的 YAML frontmatter */
function parseFrontmatter(content) {
  const meta = { name: '', description: '' };
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (match) {
    const yamlText = match[1];
    yamlText.split('\n').forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let val = parts.slice(1).join(':').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1).trim();
        }
        if (key === 'name') meta.name = val;
        if (key === 'description') meta.description = val;
      }
    });
  }
  return meta;
}

/** 获取所有 Skill 元数据 */
app.get('/api/skills', async (req, res) => {
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true });
    const items = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills = [];

    for (const item of items) {
      if (!item.isDirectory()) continue;
      
      const skillId = item.name;
      const skillMdPath = path.join(SKILLS_DIR, skillId, 'SKILL.md');
      
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const meta = parseFrontmatter(content);
        
        skills.push({
          id: skillId,
          name: meta.name || skillId,
          desc: meta.description || '专业技能说明',
          file: `skills/${skillId}/SKILL.md`
        });
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`解析技能 ${skillId} 失败:`, err);
        }
      }
    }

    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取后端注册的所有工具 Schema */
app.get('/api/tools', (req, res) => {
  res.json(getToolSchemas());
});

/** Agent 运行端点 (单路 SSE 控制流) */
app.post('/api/agent/run', async (req, res) => {
  const {
    messages,
    todos,
    systemPrompt,
    tools,
    features,
    model,
    temperature,
    maxTokens,
    thinkingEnabled,
    skills
  } = req.body;

  if (!model?.key) {
    return res.status(400).json({ error: '缺少 API Key' });
  }

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const executor = new AgentExecutor({
    messages,
    todos,
    systemPrompt,
    tools,
    features,
    model,
    temperature,
    maxTokens,
    thinkingEnabled,
    skills,
    onEvent: (type, data) => {
      sendEvent(res, type, data);
    }
  });

  try {
    await executor.run();
  } catch (err) {
    console.error('[server.js /api/agent/run] 运行异常:', err);
    sendEvent(res, 'error', { message: err.message });
  } finally {
    res.end();
  }
});

/** 健康检查 */
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

/**
 * GET /api/models
 * 从已加载的 process.env 读取模型列表（启动时由 .env 加载）
 */
app.get('/api/models', async (req, res) => {
  try {
    if (process.env.MODELS_CONFIG) {
      return res.json(JSON.parse(process.env.MODELS_CONFIG));
    }
    return res.json([]);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    process.env.MODELS_CONFIG = JSON.stringify(models);  // 同步更新内存
    res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/sessions/:harnessId - 加载会话记录 */
app.get('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const sessionPath = path.join(SESSIONS_DIR, `${harnessId}.json`);
    const content = await fs.readFile(sessionPath, 'utf-8');
    res.json(JSON.parse(content));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.json(null); // 不存在则返回 null
    }
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/sessions/:harnessId - 保存/同步会话记录 */
app.post('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const { messages, todos } = req.body;
    const sessionPath = path.join(SESSIONS_DIR, `${harnessId}.json`);
    await fs.writeFile(sessionPath, JSON.stringify({ messages: messages || [], todos: todos || [] }, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/sessions/:harnessId - 删除/重置会话记录 */
app.delete('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const sessionPath = path.join(SESSIONS_DIR, `${harnessId}.json`);
    await fs.unlink(sessionPath).catch(() => {}); // 允许文件不存在
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 LLM Space 代理服务器运行在 http://localhost:${PORT}`);
  console.log(`   前端访问：http://localhost:5174\n`);
});
