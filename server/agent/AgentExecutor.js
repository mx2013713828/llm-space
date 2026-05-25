import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { toolRegistry } from '../tools/ToolRegistry.js';
import { buildApiMessages, compactMessages, estimateTokens, injectTodoState, alignRequestPayload } from './messageBuilder.js';
import { COMPACT_PROMPT } from './compactPrompt.js';

// 物理常量配置
export const OFFLOAD_THRESHOLD_BYTES = 20000;
export const OFFLOAD_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;
export const SOFT_COMPACT_TOKEN_THRESHOLD = 120000;
export const HARD_COMPACT_TOKEN_THRESHOLD = 160000;

/** Helper function: parse Markdown YAML frontmatter */
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

/**
 * AgentExecutor — 后端 Agent 循环执行器
 * 负责在后端维护 ReAct 循环，流式调用大模型 API，解析并分发工具执行事件。
 */
export class AgentExecutor {
  /**
   * 构造函数
   * @param {Object} params
   * @param {Array} params.messages - 初始消息历史
   * @param {Array} params.todos - 看板 TODO 状态
   * @param {string} params.systemPrompt - 系统提示词
   * @param {Array} params.tools - 启用的工具配置
   * @param {Object} params.features - 实验性功能开关
   * @param {Object} params.model - 选中的模型配置 (name, key, url, modelId)
   * @param {number} params.temperature - 温度
   * @param {number} params.maxTokens - 最大 token 数
   * @param {boolean} params.thinkingEnabled - 是否启用思维链
   * @param {Function} params.onEvent - SSE 事件广播回调 (type, data)
   */
  constructor({
    harnessId = '',
    messages = [],
    todos = [],
    systemPrompt = '',
    tools = [],
    features = {},
    model = {},
    temperature = 1,
    maxTokens = 8192,
    thinkingEnabled = false,
    skills = [],
    onEvent = () => {}
  }) {
    this.harnessId = harnessId;
    this.messages = [...messages];
    this.todos = [...todos];
    this.systemPrompt = systemPrompt;
    this.tools = tools;
    this.features = features;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.thinkingEnabled = thinkingEnabled;
    this.skills = [...skills];
    this.onEvent = onEvent;

    this.roundsSinceTodo = 0;
    this.compactionEnabled = this.features.context_compaction !== false;
    this.contextTokens = 0;
    this._lastInputTokens = 0;
    this.hardCompactTriggered = false;
    this.saveQueue = Promise.resolve();
  }

  /**
   * Save session state to disk
   * @returns {Promise<void>}
   */
  async saveSession() {
    // Check if harnessId exists, return if empty
    if (!this.harnessId) {
      return;
    }

    if (!this.saveQueue) {
      this.saveQueue = Promise.resolve();
    }

    // Queue up the save operation to prevent concurrent writes corruption
    this.saveQueue = this.saveQueue.then(async () => {
      try {
        const sessionPath = path.join(process.cwd(), 'server', 'sessions', `${this.harnessId}.json`);
        const sessionsDir = path.dirname(sessionPath);

        // Ensure that server/sessions/ directory exists
        await fs.mkdir(sessionsDir, { recursive: true });

        // Auto-save agent messages and todos state to session file
        await fs.writeFile(
          sessionPath,
          JSON.stringify({ messages: this.messages, todos: this.todos }, null, 2),
          'utf-8'
        );
      } catch (err) {
        console.error('[AgentExecutor] Failed to save session:', err);
      }
    });

    await this.saveQueue;
  }

  /**
   * Clean up physically expired offloaded files
   * @returns {Promise<void>}
   */
  async cleanupOffloadedFiles() {
    try {
      const offloadedDir = path.join(process.cwd(), '.offloaded');
      try {
        await fs.access(offloadedDir);
      } catch {
        // Directory does not exist, return early
        return;
      }

      const files = await fs.readdir(offloadedDir);
      for (const file of files) {
        if (!file.startsWith('offload-') || !file.endsWith('.txt')) {
          continue;
        }

        const filePath = path.join(offloadedDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtime.getTime() > OFFLOAD_CLEANUP_AGE_MS) {
            await fs.unlink(filePath);
          }
        } catch (statOrUnlinkErr) {
          if (statOrUnlinkErr.code !== 'ENOENT') {
            console.error(`[AgentExecutor] Failed to process/delete file ${file}:`, statOrUnlinkErr);
          }
        }
      }
    } catch (err) {
      console.error('[AgentExecutor] Failed during offload cleanup:', err);
    }
  }

  /**
   * 估算当前占用的 Token 数量
   * @returns {number}
   */
  estimateCurrentTokens() {
    return estimateTokens(
      this.messages,
      this.thinkingEnabled,
      this.systemPrompt,
      this.tools,
      this.contextTokens,
      this.compactionEnabled
    );
  }

  /**
   * 后台非流式大模型调用，用于生成语义历史摘要
   * @param {Array} apiMessages 
   * @param {string} systemPrompt 
   * @returns {Promise<string>}
   */
  async _callLLMNonStream(apiMessages, systemPrompt) {
    const endpoint = `${(this.model.url || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
    const isDeepSeek = endpoint.includes('deepseek.com');

    const requestBody = {
      model: this.model.modelId || 'claude-sonnet-4-5',
      max_tokens: 2048,
      system: systemPrompt,
      messages: apiMessages,
      stream: false
    };

    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': this.model.key || '',
      'anthropic-version': '2023-06-01',
    };

    if (this.thinkingEnabled && !isDeepSeek) {
      requestBody.thinking = { 
        type: 'enabled', 
        budget_tokens: 1024
      };
      requestBody.temperature = 1;
      reqHeaders['anthropic-beta'] = 'interleaved-thinking-2025-05-07';
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Summary API error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    let text = '';
    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          text += block.text;
        }
      }
    }
    return text.trim();
  }

  /**
   * 启动 ReAct 决策循环并自主运行直到最终文字回复或被强行终止
   */
  async run() {
    try {
      // 1. 根据当前消息历史，计算出主循环的起始轮次
      const turns = {};
      this.messages.forEach(msg => {
        const t = msg.turn || 1;
        if (!turns[t]) turns[t] = [];
        turns[t].push(msg);
      });
      let turnIndex = Object.keys(turns).length || 1;

      // 2. 开启 ReAct 循环，限制最大 15 轮
      // Save session before loop starts to persist the initial user request
      await this.saveSession();
      for (let cycle = 0; cycle < 15; cycle++) {
        const currentTokens = this.estimateCurrentTokens();

        // 阶段二：进行上下文软清洗 (Soft Compact Epoch)
        const compactResult = compactMessages(
          this.messages,
          turnIndex,
          currentTokens,
          this.systemPrompt,
          this.tools,
          this.thinkingEnabled,
          this.compactionEnabled
        );

        if (compactResult.compactedCount > 0) {
          this.messages = compactResult.messages;
          if (compactResult.estimatedTokens != null) {
            this.contextTokens = compactResult.estimatedTokens;
          }
          // 当发生软压缩时，主动向前端广播 messages_update 事件，使前端同步轨迹
          this.onEvent('messages_update', { messages: this.messages });
          // Save session after soft compaction
          await this.saveSession();
        }

        // 阶段三：全量语义总结与记忆重建 (Hard Compact Stage 2)
        const tokensAfterSoft = this.contextTokens > 0 ? this.contextTokens : this.estimateCurrentTokens();
        if (this.compactionEnabled && tokensAfterSoft > HARD_COMPACT_TOKEN_THRESHOLD && !this.hardCompactTriggered && this.messages.length > 10) {
          try {
            console.log(`🌊 触发 Hard-Compact 全量语义总结，当前 Token 估算：${tokensAfterSoft}...`);

            // 1. 广播系统提示给前端
            this.messages.push({
              role: 'system',
              type: 'system_alert',
              turn: turnIndex,
              content: '⚠️ 上下文即将溢出！正在使用大模型生成历史战局摘要并重建记忆...'
            });
            this.onEvent('messages_update', { messages: this.messages });

            // 2. 备份完整历史对话到磁盘 (.transcripts)
            const transcriptsDir = path.join(process.cwd(), '.transcripts');
            await fs.mkdir(transcriptsDir, { recursive: true });
            const transcriptFile = path.join(transcriptsDir, `transcript-${Date.now()}-${turnIndex}.jsonl`);
            const jsonlData = this.messages.map(m => JSON.stringify(m)).join('\n');
            await fs.writeFile(transcriptFile, jsonlData, 'utf-8');

            // 3. 构建发送给 LLM 摘要的消息包
            const messagesToSummarize = this.messages.filter(m => m.type !== 'system_alert');
            const summaryMessages = buildApiMessages(messagesToSummarize, false, false);

            const summaryRaw = await this._callLLMNonStream(summaryMessages, COMPACT_PROMPT);
            
            let summary = summaryRaw;
            // Remove <analysis>...</analysis> tags and contents if present (handling unclosed analysis tags dynamically)
            summary = summary.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
            // Try to extract the summary content inside <summary>...</summary>
            const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(summary);
            if (summaryMatch) {
              summary = summaryMatch[1].trim();
            } else {
              // Strip leftover tags as fallback
              summary = summary.replace(/<\/?summary>/gi, '').trim();
            }

            console.log('✅ Hard-Compact 语义摘要生成成功，长度为:', summary.length);

            // 4. 重建 messages 消息队列 (保留最近 3 轮的活跃对话)
            const activeMessages = this.messages.filter(msg => turnIndex - (msg.turn || 1) < 3);

            const summaryMsg = {
              role: 'user',
              type: 'system_alert',
              turn: turnIndex,
              content: `[System Memory Compacted]\nHere is the summarized history of the project so far:\n\n${summary}\n\nThe complete historical transcript has been persisted to disk.`
            };

            // 注入恢复工作的 Prompt 指令
            const resumeMsg = {
              role: 'user',
              type: 'system_alert',
              turn: turnIndex,
              content: `Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`
            };

            this.messages = [summaryMsg, ...activeMessages, resumeMsg];
            this.contextTokens = 0; // 重置 token 估算缓存
            this.hardCompactTriggered = true; // 确保单次循环内不重复触发

            // 广播更新
            this.onEvent('messages_update', { messages: this.messages });
            // Save session after hard compaction
            await this.saveSession();
          } catch (compactErr) {
            console.error('[AgentExecutor] Failed to perform Hard-Compact:', compactErr);
          }
        }

        // 3. 构建待发送给 API 的消息历史结构
        let apiMessages = buildApiMessages(this.messages, this.thinkingEnabled, this.compactionEnabled);

        // 注入 TODO 状态与催促机制
        apiMessages = injectTodoState(apiMessages, this.todos, this.roundsSinceTodo);

        let stopReason = null;
        let hasUpdatedTodoThisTurn = false;

        try {
          // 调用大模型
          stopReason = await this._callLLM(apiMessages, turnIndex);
        } catch (err) {
          console.error('[AgentExecutor] 调用大模型失败:', err);
          const errMsg = `❌ **大模型请求失败**: ${err.message}`;
          this.messages.push({
            role: 'assistant',
            type: 'text',
            turn: turnIndex,
            content: errMsg
          });
          this.onEvent('error', { message: err.message });
          break;
        }

        // 4. 判断是否需要执行工具
        if (stopReason === 'tool_use') {
          // 收集这一轮大模型发起的全部工具调用
          const toolsToRun = this.messages.filter(m => m.turn === turnIndex && m.type === 'tool_call');

          const executeToolCall = async (tool) => {
            // 发送工具准备开始执行事件
            this.onEvent('tool_exec_start', { id: tool.id, toolName: tool.toolName });

            if (tool.toolName === 'sub_agent' && tool.toolInput?.prompt) {
              try {
                // 实例化子代理：继承主配置，但过滤掉 sub_agent 工具防套娃
                const subExecutor = new AgentExecutor({
                  messages: [{ role: 'user', content: tool.toolInput.prompt }],
                  systemPrompt: '你是一个子代理（Sub-agent）。请根据用户的具体任务，利用工具完成研究或操作。完成任务后，请输出最终的总结报告。请尽力而为，如果尝试多次失败也请如实报告。',
                  tools: this.tools.filter(t => t.name !== 'sub_agent'),
                  features: this.features,
                  model: this.model,
                  temperature: this.temperature,
                  maxTokens: this.maxTokens,
                  thinkingEnabled: this.thinkingEnabled,
                  onEvent: (subType, subPayload) => {
                    // 将子代理的事件透传给前端，但带上 parentToolCallId 以便前端在 UI 中渲染二级轨迹
                    this.onEvent(subType, { ...subPayload, parentToolCallId: tool.id });
                  }
                });

                // 子代理执行
                await subExecutor.run();

                // 从子代理最终产生的内容中，提炼文字总结
                const textBlocks = subExecutor.messages.filter(m => m.type === 'text').map(m => m.content);
                tool.toolOutput = textBlocks.length > 0 ? textBlocks.join('') : '(子代理运行完毕，未返回任何文字总结)';
              } catch (err) {
                tool.toolOutput = `[子代理异常崩溃]\n${err.message}`;
              }
            } else if (tool.toolName === 'write_todos') {
              // 系统级拦截 write_todos
              this.todos = tool.toolInput?.todos || [];
              hasUpdatedTodoThisTurn = true;

              const completedCount = this.todos.filter(t => t.status === 'completed').length;
              tool.toolOutput = `[系统] 已更新看板。当前进度: ${completedCount}/${this.todos.length} 已完成。`;

              // 触发 todo_update 事件，使前端实时渲染看板
              this.onEvent('todo_update', { todos: this.todos });
            } else {
              try {
                // 执行常规的本地工具，并传入流式输出回调
                const finalOutput = await toolRegistry.execute(tool.toolName, tool.toolInput, (chunk) => {
                  tool.toolOutput = (tool.toolOutput || '') + chunk;
                  // 推送工具流式日志 chunk 到前端
                  this.onEvent('tool_exec_chunk', { id: tool.id, content: chunk });
                });
                tool.toolOutput = String(finalOutput);
              } catch (err) {
                tool.toolOutput = `[工具执行错误]\n${err.message}`;
              }
            }

            // 大结果实时落盘拦截
            if (
              tool.toolName !== 'read_file' &&
              typeof tool.toolOutput === 'string' &&
              Buffer.byteLength(tool.toolOutput, 'utf-8') > OFFLOAD_THRESHOLD_BYTES
            ) {
              try {
                const offloadedDir = path.join(process.cwd(), '.offloaded');
                await fs.mkdir(offloadedDir, { recursive: true });
                const offloadedFileName = `offload-${this.harnessId}-${tool.id}.txt`;
                const offloadedFilePath = path.join(offloadedDir, offloadedFileName);
                await fs.writeFile(offloadedFilePath, tool.toolOutput, 'utf-8');

                const originalSize = Buffer.byteLength(tool.toolOutput, 'utf-8');
                const headPreview = tool.toolOutput.slice(0, 1500);
                const tailPreview = tool.toolOutput.slice(-500);

                tool.toolOutput = `[OUTPUT OFFLOADED TO FILE: .offloaded/offload-${this.harnessId}-${tool.id}.txt (size: ${originalSize} bytes).
--- PREVIEW START (First 1500 chars) ---
${headPreview}
--- PREVIEW END ---
...[OUTPUT OFFLOADED - If you need the full content, use read_file tool on the offloaded path above]...
--- TAIL PREVIEW (Last 500 chars) ---
${tailPreview}
--- TAIL END ---]`;
              } catch (offloadErr) {
                console.error('[AgentExecutor] Failed to offload large tool output:', offloadErr);
              }
            }

            // 工具执行完毕，重置 contextTokens 缓存并广播 tool_exec_done
            this.contextTokens = 0;
            this.onEvent('tool_exec_done', { id: tool.id, output: tool.toolOutput });
            // Save session after tool execution is complete
            await this.saveSession();
          };

          const isParallel = this.features?.parallel_tool_execution === true;

          if (isParallel) {
            await Promise.all(toolsToRun.map(executeToolCall));
          } else {
            for (const tool of toolsToRun) {
              await executeToolCall(tool);
            }
          }

          // 看板轮数累加计数器更新
          this.roundsSinceTodo = hasUpdatedTodoThisTurn ? 0 : this.roundsSinceTodo + 1;
          turnIndex++;
          
          // 轮询间隙，给予极短的缓冲时间
          await new Promise(r => setTimeout(r, 500));

          // Save session at the end of each ReAct cycle
          await this.saveSession();
        } else {
          // 完成文字回复，主动退出 ReAct 循环
          break;
        }
      }
    } finally {
      // Save session on exit
      await this.saveSession();
      // Clean up physically expired offloaded files before exit
      this.cleanupOffloadedFiles().catch(err => console.error('[AgentExecutor] Failed to cleanup offloaded files:', err));
      // 5. 循环决策结束，发送 done
      this.onEvent('done', {});
    }
  }

  /**
   * 私有方法：调用大模型，解析流式响应并回传事件
   * @param {Array} apiMessages - 已经过清洗并注入了 TODO 状态的 API 消息包
   * @param {number} turnIndex - 当前 ReAct 循环轮次
   * @returns {Promise<string>} stop_reason
   */
  async _callLLM(apiMessages, turnIndex) {
    const endpoint = `${(this.model.url || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
    const isDeepSeek = endpoint.includes('deepseek.com');

    // 提取目前启用的工具清单并生成后端统一定义的 Schema
    const enabledToolNames = this.tools.map(t => typeof t === 'string' ? t : t.name);
    const toolSchemas = toolRegistry.getSchemas(enabledToolNames) || [];

    // 1. 动态对齐装配带资产的技能树
    const SKILLS_DIR = path.join(process.cwd(), 'skills');
    const includeGlobal = this.features?.enable_global_skills === true;
    
    const richSkills = [];
    
    // 递归函数辅助
    const scanDirFilesSync = async (dirPath) => {
      const files = [];
      try {
        const items = await fs.readdir(dirPath, { withFileTypes: true });
        for (const item of items) {
          const fullPath = path.join(dirPath, item.name);
          if (item.isDirectory()) {
            const sub = await scanDirFilesSync(fullPath);
            files.push(...sub);
          } else {
            files.push(fullPath);
          }
        }
      } catch (e) {}
      return files;
    };

    if (this.features?.enable_skills !== false) {
      for (const skillId of (this.skills || [])) {
        // 优先从项目本地查找
        let skillDir = path.join(SKILLS_DIR, skillId);
        let skillMdPath = path.join(skillDir, 'SKILL.md');
        let isGlobal = false;
        let exists = await fs.access(skillMdPath).then(() => true).catch(() => false);

        if (!exists && includeGlobal) {
          // 如果本地没有且开启了全局，尝试从全局 ~/.agents/skills 查找
          skillDir = path.join(os.homedir(), '.agents', 'skills', skillId);
          skillMdPath = path.join(skillDir, 'SKILL.md');
          exists = await fs.access(skillMdPath).then(() => true).catch(() => false);
          isGlobal = true;
        }

        if (exists) {
          try {
            // Read SKILL.md to parse metadata
            const content = await fs.readFile(skillMdPath, 'utf-8');
            const meta = parseFrontmatter(content);

            const rawScripts = await scanDirFilesSync(path.join(skillDir, 'scripts'));
            const rawRefs = await scanDirFilesSync(path.join(skillDir, 'references'));
            
            const scripts = rawScripts.map(p => isGlobal ? p : path.relative(process.cwd(), p));
            const references = rawRefs.map(p => isGlobal ? p : path.relative(process.cwd(), p));

            richSkills.push({
              id: skillId,
              name: meta.name || skillId,
              description: meta.description || 'Professional skill description',
              file: isGlobal ? skillMdPath : path.relative(process.cwd(), skillMdPath),
              assets: { scripts, references }
            });
          } catch (e) {
            richSkills.push({
              id: skillId,
              name: skillId,
              description: 'Professional skill description',
              file: `skills/${skillId}/SKILL.md`,
              assets: { scripts: [], references: [] }
            });
          }
        } else {
          // Safe fallback if not found
          richSkills.push({
            id: skillId,
            name: skillId,
            description: 'Professional skill description',
            file: `skills/${skillId}/SKILL.md`,
            assets: { scripts: [], references: [] }
          });
        }
      }
    }

    // 使用 alignRequestPayload 进行对齐 and 重排
    const aligned = alignRequestPayload(
      this.systemPrompt || '',
      toolSchemas,
      apiMessages,
      this.model,
      richSkills
    );

    // 准备大模型 API 请求体
    const requestBody = {
      model: this.model.modelId || 'claude-sonnet-4-5',
      max_tokens: this.maxTokens || 8192,
      system: aligned.system || '',
      messages: aligned.messages || [],
      stream: true,
    };

    if (aligned.tools && aligned.tools.length > 0) {
      requestBody.tools = aligned.tools;
    }

    // 处理大模型推理的扩展思考 (Extended Thinking) 特性
    if (this.thinkingEnabled) {
      requestBody.thinking = { 
        type: 'enabled', 
        budget_tokens: Math.floor(Math.min(this.maxTokens * 0.6 || 5000, 10000)) 
      };
      if (!isDeepSeek) {
        requestBody.temperature = 1;
        requestBody.betas = ['interleaved-thinking-2025-05-07'];
      }
    } else if (isDeepSeek) {
      requestBody.thinking = { type: 'disabled' };
      if (this.temperature !== undefined) requestBody.temperature = this.temperature;
    } else if (this.temperature !== undefined) {
      requestBody.temperature = this.temperature;
    }

    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': this.model.key || '',
      'anthropic-version': '2023-06-01',
    };
    if (this.thinkingEnabled && !isDeepSeek) {
      reqHeaders['anthropic-beta'] = 'interleaved-thinking-2025-05-07';
    }

    // 发起带重试机制的请求
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
          console.log(`[AgentExecutor] 大模型请求失败 (attempt ${attempt + 1}/3): ${e.message}，1s 后重试...`);
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    if (!upstream) throw lastErr;

    if (!upstream.ok) {
      const errText = await upstream.text();
      let errMsg = `API 错误 ${upstream.status}`;
      try { errMsg = JSON.parse(errText)?.error?.message || errMsg; } catch { }
      throw new Error(errMsg);
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let currentBlockType = null;
    let currentMsg = null;
    let stopReason = null;

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
            if (evt.message?.usage?.input_tokens) {
              this._lastInputTokens = evt.message.usage.input_tokens;
              this.contextTokens = (evt.message.usage.input_tokens || 0) + (evt.message.usage.cache_read_input_tokens || 0);
            }
            this.onEvent('message_start', {
              model: evt.message?.model,
              inputTokens: evt.message?.usage?.input_tokens,
              cacheReadTokens: evt.message?.usage?.cache_read_input_tokens ?? 0,
              cacheCreationTokens: evt.message?.usage?.cache_creation_input_tokens ?? 0,
            });
            break;

          case 'content_block_start': {
            const blk = evt.content_block;
            currentBlockType = blk.type;

            if (blk.type === 'thinking') {
              currentMsg = {
                role: 'assistant',
                type: 'thinking',
                turn: turnIndex,
                content: '',
                tokens: { input: this._lastInputTokens || 0, output: 0 },
                signature: blk.signature
              };
              this.messages.push(currentMsg);
              this.onEvent('thinking_start', { index: evt.index, signature: blk.signature, turn: turnIndex });
            } else if (blk.type === 'text') {
              currentMsg = {
                role: 'assistant',
                type: 'text',
                turn: turnIndex,
                content: '',
                tokens: { input: this._lastInputTokens || 0, output: 0 }
              };
              this.messages.push(currentMsg);
              this.onEvent('text_start', { index: evt.index, turn: turnIndex });
            } else if (blk.type === 'tool_use') {
              currentMsg = {
                role: 'assistant',
                type: 'tool_call',
                turn: turnIndex,
                id: blk.id,
                toolName: blk.name,
                toolInputRaw: '',
                toolInput: {}
              };
              this.messages.push(currentMsg);
              this.onEvent('tool_start', { index: evt.index, name: blk.name, id: blk.id, turn: turnIndex });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = evt.delta;
            if (delta.type === 'thinking_delta') {
              if (currentMsg) currentMsg.content += delta.thinking;
              this.onEvent('thinking_delta', { text: delta.thinking });
            } else if (delta.type === 'text_delta') {
              if (currentMsg) currentMsg.content += delta.text;
              this.onEvent('text_delta', { text: delta.text });
            } else if (delta.type === 'input_json_delta') {
              if (currentMsg && currentMsg.type === 'tool_call') {
                currentMsg.toolInputRaw += delta.partial_json;
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch { }
              }
              this.onEvent('tool_input_delta', { partial: delta.partial_json });
            }
            break;
          }

          case 'content_block_stop':
            if (currentBlockType === 'thinking') {
              this.onEvent('thinking_end', { text: currentMsg?.content || '' });
            } else if (currentBlockType === 'text') {
              this.onEvent('text_end', { text: currentMsg?.content || '' });
            } else if (currentBlockType === 'tool_use') {
              this.onEvent('tool_end', { name: currentMsg?.toolName || '', input: currentMsg?.toolInput || {} });
            }
            currentBlockType = null;
            break;

          case 'message_delta':
            if (currentMsg && evt.usage?.output_tokens) {
              currentMsg.tokens = { ...currentMsg.tokens, output: evt.usage.output_tokens };
            }
            this.onEvent('message_delta', {
              inputTokens: evt.usage?.input_tokens,
              outputTokens: evt.usage?.output_tokens,
              cacheReadTokens: evt.usage?.cache_read_input_tokens ?? 0,
              cacheCreationTokens: evt.usage?.cache_creation_input_tokens ?? 0,
              stopReason: evt.delta?.stop_reason,
            });
            if (evt.delta?.stop_reason) {
              stopReason = evt.delta.stop_reason;
              this.onEvent('stop', {
                stopReason: evt.delta.stop_reason,
                outputTokens: evt.usage?.output_tokens,
              });
            }
            break;

          case 'error':
            this.onEvent('error', { message: evt.error?.message || '未知错误' });
            break;
        }
      }
    }

    return stopReason;
  }
}
