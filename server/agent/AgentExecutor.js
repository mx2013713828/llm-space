import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { toolRegistry } from '../tools/ToolRegistry.js';
import { buildApiMessages, compactMessages, estimateTokens, injectTodoState, alignRequestPayload } from './messageBuilder.js';
import { COMPACT_PROMPT } from './compactPrompt.js';
import { HookManager } from './HookManager.js';
import { CompactionPlugin } from './plugins/CompactionPlugin.js';
import { TodoNagPlugin } from './plugins/TodoNagPlugin.js';
import { OutputOffloadPlugin } from './plugins/OutputOffloadPlugin.js';
import { SubAgentPlugin } from './plugins/SubAgentPlugin.js';
import { SkillsPlugin } from './plugins/SkillsPlugin.js';
import { SecurityPlugin } from './plugins/SecurityPlugin.js';


// 物理常量配置
export const OFFLOAD_THRESHOLD_BYTES = 20000;
export const OFFLOAD_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;
export const SOFT_COMPACT_TOKEN_THRESHOLD = 120000;
export const HARD_COMPACT_TOKEN_THRESHOLD = 160000;

/** Helper function: parse Markdown YAML frontmatter */

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
    this.messages = [...(Array.isArray(messages) ? messages : [])];
    this.todos = [...(Array.isArray(todos) ? todos : [])];
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

    // 初始化 Hook 管理器并按需挂载插件
    this.hooks = new HookManager();
    
    // 如果启用了安全防护机制，挂载 SecurityPlugin
    if (this.features.enable_security === true) {
      this.hooks.register(SecurityPlugin);
    }
    
    // Skills 插件默认开启（它内部会判断 this.features.enable_skills）
    this.hooks.register(SkillsPlugin);
    
    if (this.features.context_compaction !== false) {
      this.hooks.register(CompactionPlugin);
    }
    if (this.features.todo_nag !== false) {
      this.hooks.register(TodoNagPlugin);
    }
    if (this.features.output_offload !== false) {
      this.hooks.register(OutputOffloadPlugin);
    }
    this.hooks.register(SubAgentPlugin);

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
      const turns = {};
      this.messages.forEach(msg => {
        const t = msg.turn || 1;
        if (!turns[t]) turns[t] = [];
        turns[t].push(msg);
      });
      let turnIndex = Object.keys(turns).length || 1;

      await this.saveSession();

      for (let cycle = 0; cycle < 15; cycle++) {
        // 构建流水线 Context
        const context = {
          executor: this,
          messages: this.messages,
          apiMessages: buildApiMessages(this.messages, this.thinkingEnabled, this.compactionEnabled),
          systemPrompt: this.systemPrompt || '',
          tools: this.tools,
          turnIndex,
          stopReason: null,
          hasUpdatedTodoThisTurn: false
        };

        // 生命周期：onLoopStart
        await this.hooks.dispatch('onLoopStart', context);

        // 生命周期：preLLM (在这里会发生：软硬清洗压缩、Todo 看板注入、Skills 组装等)
        await this.hooks.dispatch('preLLM', context);

        try {
          // 调用大模型
          context.stopReason = await this._callLLM(context);
        } catch (err) {
          console.error('[AgentExecutor] 调用大模型失败:', err);
          this.messages.push({
            role: 'assistant',
            type: 'text',
            turn: turnIndex,
            content: `❌ **大模型请求失败**: ${err.message}`
          });
          this.onEvent('error', { message: err.message });
          break;
        }

        // 生命周期：拦截判定是否执行工具
        if (context.stopReason === 'tool_use') {
          const toolsToRun = this.messages.filter(m => m.turn === turnIndex && m.type === 'tool_call');

          const executeToolCall = async (tool) => {
            this.onEvent('tool_exec_start', { id: tool.id, toolName: tool.toolName });
            
            const toolContext = { ...context, tool };
            
            // 生命周期：preToolUse (子代理拦截、write_todos 拦截、权限校验)
            await this.hooks.dispatch('preToolUse', toolContext);

            if (!tool.handled) {
              try {
                const finalOutput = await toolRegistry.execute(tool.toolName, tool.toolInput, (chunk) => {
                  tool.toolOutput = (tool.toolOutput || '') + chunk;
                  this.onEvent('tool_exec_chunk', { id: tool.id, content: chunk });
                });
                tool.toolOutput = String(finalOutput);
              } catch (err) {
                tool.toolOutput = `[工具执行错误]\n${err.message}`;
              }
            }

            // 生命周期：postToolUse (大文本卸载)
            await this.hooks.dispatch('postToolUse', toolContext);

            this.contextTokens = 0;
            this.onEvent('tool_exec_done', { id: tool.id, output: tool.toolOutput });
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

          turnIndex++;
          await new Promise(r => setTimeout(r, 500));
          
          // 生命周期：onLoopEnd (清理垃圾，记录轮数)
          await this.hooks.dispatch('onLoopEnd', context);
          await this.saveSession();
        } else {
          // 完成文字回复，主动退出 ReAct 循环
          break;
        }
      }
    } finally {
      // 触发最终清理和保存
      await this.hooks.dispatch('onLoopEnd', { executor: this });
      await this.saveSession();
      SecurityPlugin.clearExecutorPending(this);
      this.onEvent('done', {});
    }
  }

  /**
   * 私有方法：调用大模型，解析流式响应并回传事件
   * @param {Array} apiMessages - 已经过清洗并注入了 TODO 状态的 API 消息包
   * @param {number} turnIndex - 当前 ReAct 循环轮次
   * @returns {Promise<string>} stop_reason
   */
  async _callLLM(context) {
    const { apiMessages, turnIndex, systemPrompt, tools } = context;
    const endpoint = `${(this.model.url || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
    const isDeepSeek = endpoint.includes('deepseek.com');

    // 提取目前启用的工具清单并生成后端统一定义的 Schema
    const enabledToolNames = tools.map(t => typeof t === 'string' ? t : t.name);
    const toolSchemas = toolRegistry.getSchemas(enabledToolNames) || [];

    // 使用 alignRequestPayload 进行对齐 and 重排
    const aligned = alignRequestPayload(
      systemPrompt || '',
      toolSchemas,
      apiMessages,
      this.model
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

  /**
   * 清理超期的 Offload 大工具输出临时文件
   */
  async cleanupOffloadedFiles() {
    try {
      const offloadedDir = path.join(process.cwd(), '.offloaded');
      try {
        await fs.access(offloadedDir);
      } catch {
        return; // 目录不存在
      }

      const files = await fs.readdir(offloadedDir);
      for (const file of files) {
        if (!file.startsWith('offload-') || !file.endsWith('.txt')) continue;

        const filePath = path.join(offloadedDir, file);
        try {
          const stat = await fs.stat(filePath);
          if (Date.now() - stat.mtime.getTime() > OFFLOAD_CLEANUP_AGE_MS) {
            await fs.unlink(filePath);
          }
        } catch (err) {
          if (err.code !== 'ENOENT') {
            console.error(`[AgentExecutor] Failed to process/delete file ${file}:`, err);
          }
        }
      }
    } catch (err) {
      console.error('[AgentExecutor] Failed during offload cleanup:', err);
    }
  }
}
