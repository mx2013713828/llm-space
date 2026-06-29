import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
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
import { MemoryPlugin } from './plugins/MemoryPlugin.js';
import { parseFeatures } from './FeatureParser.js';
import { TaskSystemPlugin } from './plugins/TaskSystemPlugin.js';
import { CronSchedulerPlugin } from './plugins/CronSchedulerPlugin.js';
import { TeamPlugin } from './plugins/TeamPlugin.js';
import { ExecutionStrategyPlugin } from './plugins/ExecutionStrategyPlugin.js';
import { inferModelProvider, normalizeUsageMetrics } from './usageNormalizer.js';
import { composeSystemPrompt, formatRuntimeContext, getRuntimeMetadata } from './runtimeContext.js';
import { applyToolPolicyToContext, resolveInteractionMode } from './runtime/interactionMode.js';
import { isToolEnabled, parseTextEncodedToolCalls } from './textEncodedToolCalls.js';
import { isOrchestrationEnabled, resolveOrchestrationTools } from '../../src/lib/taskOrchestration.js';
import { getModelContextWindow } from '../../src/lib/modelContext.js';


// 自定义异常类以精确区分错误路径
export class RateLimitError extends Error { constructor(msg) { super(msg); this.name = "RateLimitError"; } }
export class OverloadedError extends Error { constructor(msg) { super(msg); this.name = "OverloadedError"; } }
export class PromptTooLongError extends Error { constructor(msg) { super(msg); this.name = "PromptTooLongError"; } }
export class AuthError extends Error { constructor(msg) { super(msg); this.name = "AuthError"; } }

// 物理常量配置
export const OFFLOAD_THRESHOLD_BYTES = 20000;
export const OFFLOAD_CLEANUP_AGE_MS = 24 * 60 * 60 * 1000;
export const SOFT_COMPACT_CONTEXT_RATIO = 0.75;
export const HARD_COMPACT_CONTEXT_RATIO = 0.9;

function inferExecutorModelProvider(model = {}) {
  return inferModelProvider({}, {
    providerHint: model.provider || model.id || model.name,
    baseUrl: model.url,
    modelId: model.modelId,
  });
}

export function getCompactionTokenThresholds(model = {}) {
  const contextWindow = getModelContextWindow(model).value;
  return {
    contextWindow,
    soft: Math.floor(contextWindow * SOFT_COMPACT_CONTEXT_RATIO),
    hard: Math.floor(contextWindow * HARD_COMPACT_CONTEXT_RATIO),
  };
}

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
    runtimeRole = 'lead',
    teamContext = null,
    messages = [],
    todos = [],
    backgroundTasks = [],
    systemPrompt = '',
    tools = [],
    features = {},
    model = {},
    temperature = 1,
    maxTokens = 8192,
    thinkingEnabled = false,
    selectedStrategyId = '',
    interactionMode = null,
    skills = [],
    onEvent = () => {}
  }) {
    this.harnessId = harnessId;
    this.runtimeRole = runtimeRole;
    this.teamContext = teamContext;
    this.messages = [...(Array.isArray(messages) ? messages : [])];
    this.todos = [...(Array.isArray(todos) ? todos : [])];
    this.backgroundTasks = Array.isArray(backgroundTasks) ? [...backgroundTasks] : [];
    this.pendingNotifications = [];
    const runtimeContext = formatRuntimeContext(getRuntimeMetadata());
    this.systemPrompt = composeSystemPrompt(systemPrompt, runtimeContext);
    this.features = parseFeatures(features);
    const orchestration = this.features.task_orchestration;
    const orchestrationEnabled = isOrchestrationEnabled(orchestration);
    const isTaskSystem = orchestrationEnabled && orchestration?.mode === 'task_system';
    const isTodoMode = orchestrationEnabled && orchestration?.mode === 'todo';
    this.tools = resolveOrchestrationTools(tools, orchestration, { runtimeRole });

    if (!this.tools.some(tool => tool === 'get_current_time' || tool?.name === 'get_current_time')) {
      this.tools.push('get_current_time');
    }

    this.model = model;
    this.compactionThresholds = getCompactionTokenThresholds(model);
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.thinkingEnabled = thinkingEnabled;
    this.selectedStrategyId = String(selectedStrategyId || '').trim();
    this.interactionMode = interactionMode || resolveInteractionMode({ messages: this.messages });
    this.skills = [...skills];
    this.onEvent = onEvent;

    this.roundsSinceTodo = 0;
    this.compactionEnabled = !!(this.features.context_compaction && this.features.context_compaction.enabled);
    this.contextTokens = 0;
    this._lastInputTokens = 0;
    this.hardCompactTriggered = false;
    
    this.saveQueue = Promise.resolve();

    // 初始化 Hook 管理器并按需挂载插件
    this.hooks = new HookManager();
    
    // 挂载安全性审查拦截插件
    this.hooks.register(SecurityPlugin);
    
    // Skills 插件默认开启（它内部会判断 this.features.enable_skills）
    this.hooks.register(SkillsPlugin);
    this.hooks.register(ExecutionStrategyPlugin);
    
    if (this.features.context_compaction && this.features.context_compaction.enabled) {
      this.hooks.register(CompactionPlugin);
    }
    if (this.runtimeRole !== 'teammate' && isTaskSystem) {
      this.hooks.register(TaskSystemPlugin);
    } else if (this.runtimeRole !== 'teammate' && isTodoMode) {
      this.hooks.register(TodoNagPlugin);
    }
    if (this.features.context_compaction && this.features.context_compaction.enabled && this.features.context_compaction.output_offload) {
      this.hooks.register(OutputOffloadPlugin);
    }
    // 记忆系统插件（需 enable_memory 父开关开启）
    if (this.runtimeRole !== 'teammate' && this.features.enable_memory?.enabled) {
      this.hooks.register(MemoryPlugin);
    }
    this.hooks.register(CronSchedulerPlugin);
    this.hooks.register(SubAgentPlugin);
    if (this.runtimeRole === 'teammate' || isOrchestrationEnabled(orchestration, 'enable_agent_teams')) {
      this.hooks.register(TeamPlugin);
    }

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
        const sessionState = {
          messages: this.messages,
          todos: this.todos,
          backgroundTasks: this.backgroundTasks,
        };

        if (this.teamContext) {
          sessionState.teamContext = this.teamContext;
        }

        await fs.writeFile(sessionPath, JSON.stringify(sessionState, null, 2), 'utf-8');
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
      this.features.context_compaction
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
    const modelProvider = inferExecutorModelProvider(this.model);
    const isDeepSeek = modelProvider === 'deepseek';

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

    if (isDeepSeek) {
      requestBody.thinking = { type: 'disabled' };
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
   * 执行 Hard-Compact (全量语义记忆重构)
   * 可在 preLLM 阶段满阈值触发，或在遇到 PromptTooLongError 时紧急触发。
   */
  async performHardCompact(turnIndex) {
    console.log(`🌊 触发 Hard-Compact 全量语义总结，当前历史消息数：${this.messages.length}...`);

    this.messages.push({
      role: 'system',
      type: 'system_alert',
      turn: turnIndex,
      content: '⚠️ 上下文即将溢出！正在使用大模型生成历史战局摘要并重建记忆...'
    });
    this.onEvent('messages_update', { messages: this.messages });

    const transcriptsDir = path.join(process.cwd(), '.transcripts');
    await fs.mkdir(transcriptsDir, { recursive: true });
    const transcriptFile = path.join(transcriptsDir, `transcript-${Date.now()}-${turnIndex}.jsonl`);
    const jsonlData = this.messages.map(m => JSON.stringify(m)).join('\n');
    await fs.writeFile(transcriptFile, jsonlData, 'utf-8');

    const messagesToSummarize = this.messages.filter(m => m.type !== 'system_alert');
    const summaryMessages = buildApiMessages(messagesToSummarize, false, false);

    const summaryRaw = await this._callLLMNonStream(summaryMessages, COMPACT_PROMPT);
    
    let summary = summaryRaw;
    summary = summary.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
    const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(summary);
    if (summaryMatch) {
      summary = summaryMatch[1].trim();
    } else {
      summary = summary.replace(/<\/?summary>/gi, '').trim();
    }

    console.log('✅ Hard-Compact 语义摘要生成成功，长度为:', summary.length);

    const activeMessages = this.messages.filter(msg => (
      msg.type !== 'system_alert'
      && turnIndex - (msg.turn || 1) < 3
    ));

    const summaryMsg = {
      role: 'user',
      type: 'system_alert',
      turn: turnIndex,
      content: `[System Memory Compacted]\nHere is the summarized history of the project so far:\n\n${summary}\n\nThe complete historical transcript has been persisted to disk.`
    };

    // 更新 messages 并重置状态
    this.messages.splice(0, this.messages.length, summaryMsg, ...activeMessages);
    this.contextTokens = 0;
    this.hardCompactTriggered = true;

    this.onEvent('messages_update', { messages: this.messages });
    await this.saveSession();
  }

  async synthesizeFinalAfterToolTurnLimit(turnIndex, recoveryState) {
    const context = {
      executor: this,
      messages: this.messages,
      apiMessages: buildApiMessages(this.messages, this.thinkingEnabled, this.features.context_compaction),
      systemPrompt: `${this.systemPrompt || ''}\n\n<system_reminder>\nThe tool-use turn limit has been reached. Provide a final answer from the available tool results. Do not call tools.\n</system_reminder>`,
      tools: [],
      turnIndex,
      stopReason: null,
      hasUpdatedTodoThisTurn: false,
    };

    await this.hooks.dispatch('preLLM', context);
    const stopReason = await this._callLLM(context, recoveryState, false);
    context.stopReason = stopReason;
    this.lastRunStopReason = stopReason;
    return stopReason;
  }

  /**
   * 启动 ReAct 决策循环并自主运行直到最终文字回复或被强行终止
   */
  async run(maxTurns = 15) {
    // 2.2 优化：单次 Turn 级自愈状态隔离，防止跨轮次/实例并发污染
    const recoveryState = {
      consecutive_529: 0,
      has_escalated: false,
      recovery_count: 0,
      has_attempted_reactive_compact: false,
      continuation_tokens: [] // 记录续写中每次生成的有效 tokens
    };
    const originalMaxTokens = this.maxTokens;

    try {
      const turns = {};
      this.messages.forEach(msg => {
        const t = msg.turn || 1;
        if (!turns[t]) turns[t] = [];
        turns[t].push(msg);
      });
      let turnIndex = Object.keys(turns).length || 1;

      await this.saveSession();

      this.lastRunStopReason = null;
      let exhaustedTurns = true;
      for (let cycle = 0; cycle < maxTurns; cycle++) {
        // 构建流水线 Context
        const context = {
          executor: this,
          messages: this.messages,
          apiMessages: buildApiMessages(this.messages, this.thinkingEnabled, this.features.context_compaction),
          systemPrompt: this.systemPrompt || '',
          tools: this.tools,
          turnIndex,
          stopReason: null,
          hasUpdatedTodoThisTurn: false
        };

        // 生命周期：onLoopStart
        await this.hooks.dispatch('onLoopStart', context);

        applyToolPolicyToContext(context, this.interactionMode);

        // 生命周期：preLLM (在这里会发生：软硬清洗压缩、Todo 看板注入、Skills 组装等)
        await this.hooks.dispatch('preLLM', context);

        if (this.pendingNotifications && this.pendingNotifications.length > 0) {
          const notificationsText = this.pendingNotifications.join('\n\n');
          this.pendingNotifications = []; // 消费清空

          // 1. 注入到即将发送给大模型的 context.apiMessages 列表中。
          // 规则：如果最新的一条是 user 消息且不含 tool_result 块，则安全地 unshift 注入头部；
          // 否则（是 assistant，或虽然是 user 但包含了 tool_result），为避免 API 协议报错，必须作为一条独立的 user 消息 push 到末尾。
          const lastApiMsg = context.apiMessages[context.apiMessages.length - 1];
          const isLastMsgToolResult = lastApiMsg && lastApiMsg.role === 'user' && 
                                     Array.isArray(lastApiMsg.content) && 
                                     lastApiMsg.content.some(c => c.type === 'tool_result');

          if (lastApiMsg && lastApiMsg.role === 'user' && !isLastMsgToolResult) {
            if (Array.isArray(lastApiMsg.content)) {
              lastApiMsg.content.unshift({ type: 'text', text: notificationsText });
            }
          } else {
            context.apiMessages.push({
              role: 'user',
              content: [{ type: 'text', text: notificationsText }]
            });
          }

          // 2. 持久化，追加到 messages 历史中（标记为 bg_notification，前端据此做差异化渲染，
          //    不再与普通 user 消息合并，避免裸露 XML 污染对话流）
          this.messages.push({
            role: 'user',
            type: 'bg_notification',
            turn: turnIndex,
            content: notificationsText
          });

          // 3. 广播更新事件
          this.onEvent('messages_update', { messages: this.messages });
        }

        let stopReason = null;
        try {
          const isContinuation = recoveryState.recovery_count > 0;
          stopReason = await this._callLLM(context, recoveryState, isContinuation);
          context.stopReason = stopReason;
          this.lastRunStopReason = stopReason;
          this.maxTokens = originalMaxTokens; // 恢复 tokens 限制
        } catch (err) {
          this.maxTokens = originalMaxTokens; // 异常时也恢复
          console.error('[AgentExecutor] 调用大模型失败:', err);

          // 4.1 反应式超限剪枝 (Reactive Compaction)
          if (err instanceof PromptTooLongError && this.features.error_recovery?.reactive_compaction && !recoveryState.has_attempted_reactive_compact) {
            recoveryState.has_attempted_reactive_compact = true;
            this.onEvent('error_recovery_attempt', {
              message: '⚠️ 上下文超限 (prompt_too_long)，已触发反应式硬压缩进行历史记忆重构重试...'
            });
            try {
              await this.performHardCompact(turnIndex);
              cycle--;
              continue;
            } catch (compactErr) {
              console.error('[AgentExecutor] 反应式 Hard-Compact 失败:', compactErr);
              err = new Error(`反应式硬压缩失败: ${compactErr.message}`);
            }
          }

          // 5.1 终极报错建议拼装
          const errPayload = {
            message: err.message,
            type: err.name || 'Error',
            suggestion: (() => {
              if (err instanceof AuthError) {
                return '请检查当前模型的 API Key 是否配置正确。您可以在左侧『API 核心配置』面板中，点击『+ 添加模型』更新 Model Key，或在本地 `.env` 文件中更新对应环境变量。';
              }
              if (err instanceof PromptTooLongError) {
                return '上下文已彻底超出该模型支持的硬限制。请尝试点击右上角『重置 Session』开启新的对话，或在『🔬 实验特性』中确保开启了『大模型语义重构 (Hard-Compact)』等上下文优化开关。';
              }
              if (err.message.includes('fetch failed') || err.message.includes('timeout') || err.message.includes('ENOTFOUND')) {
                return '无法连接到大模型 API 终端。这通常是由于本地网络代理或 VPN 规则失效导致。请检查您本地终端是否配置了正确的 HTTP_PROXY/HTTPS_PROXY 环境变量，并确保 API URL 能正常解析访问。';
              }
              return '请检查大模型提供商的状态页，或尝试更换其他的模型节点继续执行。';
            })()
          };

          this.messages.push({
            role: 'assistant',
            type: 'text',
            turn: turnIndex,
            content: `❌ **大模型请求失败**\n\n**错误原因**: ${errPayload.message}\n\n💡 **排查与调试建议**:\n${errPayload.suggestion}`
          });
          this.onEvent('messages_update', { messages: this.messages });
          this.onEvent('error', errPayload);
          break;
        }

        // 3.1 & 3.2: 拦截并处理 max_tokens 引起的截断自愈
        if (context.stopReason === 'max_tokens' && this.features.error_recovery?.max_tokens_escalation) {
          if (!recoveryState.has_escalated) {
            recoveryState.has_escalated = true;
            const escalatedTokens = Math.min(this.maxTokens * 8, 64000);
            
            // 清除本轮产生的半截助手消息
            this.messages = this.messages.filter(m => !(m.turn === turnIndex && m.role === 'assistant'));
            
            this.maxTokens = escalatedTokens;
            this.onEvent('error_recovery_attempt', {
              message: `⚠️ 检测到输出截断 (max_tokens)，正在执行第 1 阶段自愈：临时提升 max_tokens 限制至 ${escalatedTokens} 并无感重新生成...`
            });
            cycle--;
            continue;
          } else if (recoveryState.recovery_count < 3) {
            // 2.5 收益递减检测
            if (this.features.error_recovery?.diminishing_returns && recoveryState.continuation_tokens.length > 0) {
              const lastTokens = recoveryState.continuation_tokens[recoveryState.continuation_tokens.length - 1];
              if (lastTokens < 50) {
                const熔断Msg = '生成收益递减熔断：检测到大模型疑似陷入死循环或输出枯竭（单次生成少于 50 tokens）。';
                this.messages.push({
                  role: 'assistant',
                  type: 'text',
                  turn: turnIndex,
                  content: `❌ **输出异常终止**: ${熔断Msg}\n\n💡 **建议**: 如果大模型在续写时陷入复读或重复标点，建议修改 Prompt 或重新提问。`
                });
                this.onEvent('messages_update', { messages: this.messages });
                this.onEvent('error', { message: 熔断Msg, suggestion: '如果大模型陷入复读或输出枯竭，请在左侧调整 Prompt 结构，或者点击『重置 Session』开启新对话。' });
                break;
              }
            }

            recoveryState.recovery_count++;
            this.onEvent('error_recovery_attempt', {
              message: `⚠️ 输出再次被截断，正在执行第 2 阶段自愈：注入续写指令（第 ${recoveryState.recovery_count}/3 次）继续生成...`
            });
            cycle--;
            continue;
          }
        }

        // 生命周期：拦截判定是否执行工具
        if (context.stopReason === 'tool_use') {
          const toolsToRun = this.messages.filter(m => m.turn === turnIndex && m.type === 'tool_call');

          const executeToolCall = async (tool) => {
            tool.toolStatus = 'running';
            this.onEvent('tool_exec_start', { id: tool.id, toolName: tool.toolName });
            
            const toolContext = { ...context, tool };
            
            // 生命周期：preToolUse (子代理拦截、write_todos 拦截、权限校验)
            await this.hooks.dispatch('preToolUse', toolContext);

            if (!tool.handled) {
              const isBgEnabled = isOrchestrationEnabled(this.features.task_orchestration, 'enable_background_tasks');
              if (tool.toolName === 'query_background_tasks') {
                const activeTasks = this.backgroundTasks.map(t => ({
                  id: t.id,
                  command: t.command,
                  status: t.status,
                  duration: t.startedAt ? Math.round((new Date() - new Date(t.startedAt)) / 1000) + 's' : 'unknown',
                  outputPreview: t.output ? t.output.slice(-500) : ''
                }));
                tool.toolOutput = JSON.stringify(activeTasks.length > 0 ? activeTasks : { message: "No active or history background tasks." }, null, 2);
                tool.handled = true;
              }

              const shouldBg = tool.toolName === 'bash' && (tool.toolInput?.run_in_background || this._isSlowCommand(tool.toolInput?.command));

              if (isBgEnabled && shouldBg) {
                // Deduplication logic
                const isAlreadyRunning = this.backgroundTasks.some(t => t.command === tool.toolInput.command && t.status === 'running');
                if (isAlreadyRunning) {
                  tool.toolOutput = `[Duplicate Command Rejected] The command "${tool.toolInput.command}" is already running in the background. Please wait for its completion notification or use query_background_tasks.`;
                  tool.handled = true;
                  return;
                }

                const bgId = `bg_${Date.now().toString().slice(-4)}${Math.floor(Math.random() * 10)}`;
                const bgTask = {
                  id: bgId,
                  toolCallId: tool.id,
                  command: tool.toolInput.command,
                  status: 'running',
                  output: '',
                  exitCode: null,
                  startedAt: new Date().toISOString()
                };
                this.backgroundTasks.push(bgTask);
                this.onEvent('background_tasks_update', { tasks: this.backgroundTasks });
                
                this._runBackgroundTask(bgTask);

                tool.toolOutput = `[Background task ${bgId} started] Result will be available when complete. Do not run this command again while it is running. You can proceed with other tasks or wait for the <task_notification> message, or use query_background_tasks to check its status.`;
                tool.handled = true;
              } else {
                try {
                  const validation = toolRegistry.validate(tool.toolName, tool.toolInput);
                  if (!validation.ok) {
                    tool.toolStatus = 'invalid_args';
                    tool.toolOutput = `[Invalid tool arguments]\n${validation.message}`;
                    this.onEvent('tool_exec_invalid', {
                      id: tool.id,
                      toolName: tool.toolName,
                      error: validation,
                    });
                  } else {
                    const finalOutput = await toolRegistry.execute(tool.toolName, tool.toolInput, (chunk) => {
                      tool.toolOutput = (tool.toolOutput || '') + chunk;
                      this.onEvent('tool_exec_chunk', { id: tool.id, content: chunk });
                    });
                    tool.toolOutput = String(finalOutput);
                    tool.toolStatus = 'completed';
                  }
                } catch (err) {
                  tool.toolOutput = `[工具执行错误]\n${err.message}`;
                  tool.toolStatus = 'failed';
                }
              }
            }

            if (!tool.toolStatus || tool.toolStatus === 'running') {
              tool.toolStatus = 'completed';
            }

            // 生命周期：postToolUse (大文本卸载)
            await this.hooks.dispatch('postToolUse', toolContext);

            this.contextTokens = 0;
            this.onEvent('tool_exec_done', { id: tool.id, output: tool.toolOutput, status: tool.toolStatus });
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
          exhaustedTurns = false;
          break;
        }
      }
      if (exhaustedTurns && this.lastRunStopReason === 'tool_use') {
        const finalStopReason = await this.synthesizeFinalAfterToolTurnLimit(turnIndex, recoveryState);
        if (finalStopReason === 'tool_use') {
          this.lastRunStopReason = 'turn_limit';
        }
      }
    } finally {
      // 触发最终清理和保存
      try {
        await this.hooks.dispatch('onLoopEnd', { executor: this });
      } catch (err) {
        console.error('[AgentExecutor] final onLoopEnd cleanup failed:', err);
      }

      try {
        await this.saveSession();
      } catch (err) {
        console.error('[AgentExecutor] final session save failed:', err);
      }

      try {
        SecurityPlugin.clearExecutorPending(this);
      } catch (err) {
        console.error('[AgentExecutor] final security cleanup failed:', err);
      }

      try {
        this.onEvent('done', {});
      } catch (err) {
        console.error('[AgentExecutor] final done event failed:', err);
      }
    }
  }

  /**
   * 私有方法：调用大模型，解析流式响应并回传事件
   * @param {Array} apiMessages - 已经过清洗并注入了 TODO 状态的 API 消息包
   * @param {number} turnIndex - 当前 ReAct 循环轮次
   * @returns {Promise<string>} stop_reason
   */
  async _callLLM(context, recoveryState, isContinuation = false) {
    const { apiMessages, turnIndex, systemPrompt, tools } = context;
    const isRetryEnabled = !!this.features.error_recovery?.http_retry;
    const maxRetries = isRetryEnabled ? 10 : 1;

    let upstream = null;
    let lastErr = null;
    let newCharsGenerated = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const baseUrl = this.model.url || 'https://api.anthropic.com';
      const cleanedUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const endpoint = `${cleanedUrl}/v1/messages`;
      const modelProvider = inferExecutorModelProvider(this.model);
      const isDeepSeek = modelProvider === 'deepseek';

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

      const messagesToSend = [...(aligned.messages || [])];
      if (isContinuation) {
        const isAnthropic = endpoint.includes('anthropic.com');
        if (!isAnthropic) {
          messagesToSend.push({
            role: 'user',
            content: 'Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.'
          });
        }
      }

      // 准备大模型 API 请求体
      const requestBody = {
        model: this.model.modelId || 'claude-sonnet-4-5',
        max_tokens: this.maxTokens || 8192,
        system: aligned.system || '',
        messages: messagesToSend,
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

      try {
        upstream = await fetch(endpoint, {
          method: 'POST',
          headers: reqHeaders,
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120000),
        });

        if (!upstream.ok) {
          let errText = '';
          try {
            errText = await upstream.text();
          } catch (e) {
            errText = `(读取错误响应体失败: ${e.message})`;
          }

          let errMsg = `API 错误 ${upstream.status}`;
          let errorType = null;
          try {
            const parsed = JSON.parse(errText);
            errMsg = parsed?.error?.message || parsed?.message || errMsg;
            errorType = parsed?.error?.type || null;
          } catch (e) {
            errMsg = errText ? errMsg + ' - ' + errText.slice(0, 200).split('\n').join(' ').split('\r').join(' ') + '...' : errMsg;
          }

          if (upstream.status === 401) {
            throw new AuthError(errMsg);
          } else if (upstream.status === 429) {
            throw new RateLimitError(errMsg);
          } else if (upstream.status === 529 || upstream.status === 503) {
            throw new OverloadedError(errMsg);
          } else if (upstream.status === 400 && (errorType === 'prompt_too_long' || errMsg.includes('prompt_too_long') || errMsg.includes('context_length_exceeded') || errMsg.includes('too many tokens'))) {
            throw new PromptTooLongError(errMsg);
          }
          throw new Error(errMsg);
        }

        // 成功获取响应，跳出重试循环并清零 529 计数
        recoveryState.consecutive_529 = 0;
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        console.error(`[AgentExecutor] 大模型请求报错 (attempt ${attempt}/${maxRetries}):`, err.message);

        // 如果重试次数没用完，且属于可重试错误
        const isNetworkErr = err.message.includes('fetch failed') || err.message.includes('timeout') || err.message.includes('ENOTFOUND') || err.message.includes('fetch');
        const isRecoverable = err instanceof RateLimitError || err instanceof OverloadedError || isNetworkErr;

        if (attempt < maxRetries && isRecoverable) {
          if (err instanceof OverloadedError) {
            recoveryState.consecutive_529++;
            const fallbackModelId = this.features.error_recovery?.fallback_model_id;
            if (recoveryState.consecutive_529 >= 3 && this.features.error_recovery?.fallback_model && fallbackModelId) {
              try {
                let models = [];
                if (process.env.MODELS_CONFIG) {
                  models = JSON.parse(process.env.MODELS_CONFIG);
                }
                const fallbackModel = models.find(m => m.id === fallbackModelId);
                if (fallbackModel) {
                  this.model = {
                    name: fallbackModel.name,
                    modelId: fallbackModel.modelId,
                    key: fallbackModel.key,
                    url: fallbackModel.url || 'https://api.anthropic.com'
                  };
                  this.onEvent('error_recovery_fallback', {
                    message: `⚡ 由于大模型连续过载 (529 Overloaded)，系统已自动故障转移切换至备用模型 [${fallbackModel.name}] 继续运行`
                  });
                  recoveryState.consecutive_529 = 0;
                }
              } catch (e) {
                console.error('[AgentExecutor] Fallover 寻找备用模型失败:', e);
              }
            }
          }

          let delayMs = Math.min(500 * (2 ** (attempt - 1)), 32000);
          delayMs = Math.round(delayMs + Math.random() * (delayMs * 0.25));

          const delaySecs = (delayMs / 1000).toFixed(1);
          this.onEvent('error_recovery_attempt', {
            message: `⚠️ 大模型 API 遇到服务限流/过载或网络抖动 (${err.name || '网络异常'})，正在执行第 ${attempt} 次指数退避自愈，等待 ${delaySecs}s 后重新发起...`
          });

          await new Promise(resolve => setTimeout(resolve, delayMs));
        } else {
          throw err;
        }
      }
    }

    if (!upstream) {
      throw lastErr || new Error('大模型调用请求失败');
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
          case 'message_start': {
            if (evt.message?.usage) {
              const usageMetrics = normalizeUsageMetrics(evt.message.usage, {
                baseUrl: this.model.url,
                modelId: this.model.modelId || this.model.name,
              });
              this._lastInputTokens = usageMetrics.inputTokens;
              this.contextTokens = usageMetrics.totalInputTokens;
              this.onEvent('message_start', {
                model: evt.message?.model,
                inputTokens: usageMetrics.inputTokens,
                totalInputTokens: usageMetrics.totalInputTokens,
                cacheReadTokens: usageMetrics.cacheHitTokens,
                cacheCreationTokens: usageMetrics.cacheWriteTokens,
                cacheHitTokens: usageMetrics.cacheHitTokens,
                cacheMissTokens: usageMetrics.cacheMissTokens,
                cacheWriteTokens: usageMetrics.cacheWriteTokens,
                cacheSupportsWriteTokens: usageMetrics.cacheSupportsWriteTokens,
                cacheProvider: usageMetrics.cacheProvider,
              });
            } else {
              this.onEvent('message_start', {
                model: evt.message?.model,
                inputTokens: 0,
                totalInputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                cacheHitTokens: 0,
                cacheMissTokens: 0,
                cacheWriteTokens: 0,
                cacheSupportsWriteTokens: false,
                cacheProvider: 'generic',
              });
            }
            break;
          }

          case 'content_block_start': {
            const blk = evt.content_block;
            currentBlockType = blk.type;
            const streamMessageId = `msg_${turnIndex}_${evt.index}_${blk.type}`;

            if (blk.type === 'thinking') {
              currentMsg = {
                id: streamMessageId,
                role: 'assistant',
                type: 'thinking',
                turn: turnIndex,
                content: '',
                tokens: { input: this._lastInputTokens || 0, output: 0 },
                signature: blk.signature
              };
              this.messages.push(currentMsg);
              this.onEvent('thinking_start', { id: currentMsg.id, index: evt.index, signature: blk.signature, turn: turnIndex });
            } else if (blk.type === 'text') {
              if (isContinuation) {
                currentMsg = this.messages.findLast(m => m.role === 'assistant' && m.type === 'text');
              } else {
                currentMsg = {
                  id: streamMessageId,
                  role: 'assistant',
                  type: 'text',
                  turn: turnIndex,
                  content: '',
                  tokens: { input: this._lastInputTokens || 0, output: 0 }
                };
                this.messages.push(currentMsg);
              }
              this.onEvent('text_start', { id: currentMsg?.id, index: evt.index, turn: turnIndex, isContinuation });
            } else if (blk.type === 'tool_use') {
              currentMsg = {
                role: 'assistant',
                type: 'tool_call',
                turn: turnIndex,
                id: blk.id,
                toolName: blk.name,
                toolInputRaw: '',
                toolInput: {},
                toolStatus: 'pending'
              };
              this.messages.push(currentMsg);
              this.onEvent('tool_start', { index: evt.index, name: blk.name, id: blk.id, turn: turnIndex });
            }
            break;
          }

          case 'content_block_delta': {
            const delta = evt.delta;
            if (delta.type === 'thinking_delta') {
              if (currentMsg?.type !== 'thinking') {
                currentMsg = {
                  id: `msg_${turnIndex}_${evt.index}_thinking`,
                  role: 'assistant',
                  type: 'thinking',
                  turn: turnIndex,
                  content: '',
                  tokens: { input: this._lastInputTokens || 0, output: 0 },
                  signature: ''
                };
                currentBlockType = 'thinking';
                this.messages.push(currentMsg);
                this.onEvent('thinking_start', { id: currentMsg.id, index: evt.index, signature: '', turn: turnIndex });
              }
              if (currentMsg) currentMsg.content += delta.thinking;
              this.onEvent('thinking_delta', { id: currentMsg?.id, text: delta.thinking });
            } else if (delta.type === 'text_delta') {
              if (currentMsg?.type !== 'text') {
                if (currentMsg?.type === 'thinking') {
                  this.onEvent('thinking_end', { id: currentMsg.id, text: currentMsg.content || '' });
                }
                currentMsg = isContinuation
                  ? this.messages.findLast(m => m.role === 'assistant' && m.type === 'text')
                  : null;
                if (!currentMsg) {
                  currentMsg = {
                    id: `msg_${turnIndex}_${evt.index}_text`,
                    role: 'assistant',
                    type: 'text',
                    turn: turnIndex,
                    content: '',
                    tokens: { input: this._lastInputTokens || 0, output: 0 }
                  };
                  this.messages.push(currentMsg);
                }
                currentBlockType = 'text';
                this.onEvent('text_start', { id: currentMsg?.id, index: evt.index, turn: turnIndex, isContinuation });
              }
              if (currentMsg) currentMsg.content += delta.text;
              if (isContinuation) {
                newCharsGenerated += delta.text.length;
              }
              this.onEvent('text_delta', { id: currentMsg?.id, text: delta.text });
            } else if (delta.type === 'input_json_delta') {
              if (currentMsg && currentMsg.type === 'tool_call') {
                currentMsg.toolInputRaw += delta.partial_json;
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch { }
              }
              this.onEvent('tool_input_delta', { id: currentMsg?.id, partial: delta.partial_json });
            }
            break;
          }

          case 'content_block_stop':
            if (currentBlockType === 'thinking') {
              this.onEvent('thinking_end', { id: currentMsg?.id, text: currentMsg?.content || '' });
            } else if (currentBlockType === 'text') {
              this.onEvent('text_end', { id: currentMsg?.id, text: currentMsg?.content || '' });
            } else if (currentBlockType === 'tool_use') {
              this.onEvent('tool_end', { id: currentMsg?.id, name: currentMsg?.toolName || '', input: currentMsg?.toolInput || {} });
            }
            currentBlockType = null;
            break;

          case 'message_delta':
            if (evt.delta?.stop_reason === 'end_turn' && currentMsg?.type === 'thinking') {
              const foldedResponse = /^\[Thinking folded\]\s*(?:response)?\s*([\s\S]+)$/i.exec(currentMsg.content || '');
              const answer = foldedResponse?.[1]?.trim();
              if (answer) {
                currentMsg.content = '[Thinking folded]';
                currentMsg = {
                  id: `msg_${turnIndex}_folded_text`,
                  role: 'assistant',
                  type: 'text',
                  turn: turnIndex,
                  content: answer,
                  tokens: { input: this._lastInputTokens || 0, output: 0 }
                };
                currentBlockType = 'text';
                this.messages.push(currentMsg);
                this.onEvent('messages_update', { messages: this.messages });
              }
            }
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

    const recoveredStopReason = this._recoverTextEncodedToolCalls({ turnIndex, tools });
    if (recoveredStopReason) {
      stopReason = recoveredStopReason;
    }

    if (isContinuation) {
      const generatedTokens = Math.round(newCharsGenerated / 3);
      recoveryState.continuation_tokens.push(generatedTokens);
    }

    return stopReason;
  }

  _recoverTextEncodedToolCalls({ turnIndex, tools }) {
    const textIndex = this.messages.findLastIndex(message =>
      message?.turn === turnIndex
      && message.role === 'assistant'
      && message.type === 'text'
      && typeof message.content === 'string'
    );
    if (textIndex === -1) return null;

    const textMessage = this.messages[textIndex];
    const calls = parseTextEncodedToolCalls(textMessage.content);
    if (!calls) return null;

    const unavailable = calls.find(call => !isToolEnabled(tools, call.name));
    if (unavailable) {
      textMessage.content = `⚠️ Model emitted a text-encoded tool call for unavailable tool \`${unavailable.name}\`; it was not executed.`;
      this.onEvent('messages_update', { messages: this.messages });
      this.onEvent('error', {
        message: `Text-encoded tool call could not be executed: ${unavailable.name}`,
      });
      return 'end_turn';
    }

    const toolMessages = calls.map((call, index) => ({
      role: 'assistant',
      type: 'tool_call',
      turn: turnIndex,
      id: `toolu_text_${turnIndex}_${index}`,
      toolName: call.name,
      toolInputRaw: JSON.stringify(call.input),
      toolInput: call.input,
      toolStatus: 'pending',
    }));

    this.messages.splice(textIndex, 1, ...toolMessages);
    this.onEvent('messages_update', { messages: this.messages });
    this.onEvent('text_encoded_tool_call_recovered', {
      turn: turnIndex,
      toolNames: calls.map(call => call.name),
    });

    return 'tool_use';
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

  _isSlowCommand(command) {
    const cmd = String(command || '').toLowerCase();
    const slowKeywords = [
      'install', 'build', 'test', 'deploy', 'compile',
      'docker build', 'pip install', 'npm install', 'yarn',
      'cargo build', 'pytest', 'make'
    ];
    return slowKeywords.some(kw => cmd.includes(kw));
  }

  _runBackgroundTask(bgTask) {
    const env = { 
      ...process.env, 
      FORCE_COLOR: '1', 
      PYTHONUNBUFFERED: '1',
      PIP_PROGRESS_BAR: 'on',
      TERM: 'xterm-256color' 
    };

    const child = spawn('bash', ['-c', bgTask.command], { env });
    
    let lastOutputTime = Date.now();

    // 5-minute hard timeout protection
    const timeoutHandle = setTimeout(() => {
      clearInterval(stallCheckInterval);
      bgTask.output += '\n[TIMEOUT] Task exceeded 5 minutes timeout limit. Process killed.';
      child.kill('SIGKILL');
    }, 5 * 60 * 1000);

    // 45-second Stall Watchdog
    const stallCheckInterval = setInterval(() => {
      if (Date.now() - lastOutputTime > 45000) {
        clearInterval(stallCheckInterval);
        clearTimeout(timeoutHandle);
        
        const lastChars = bgTask.output.trim().slice(-100).toLowerCase();
        const isPrompt = /\[y\/n\]|\(y\/n\)|password:|please select:|choose:|continue\?/i.test(lastChars);
        
        bgTask.output += '\n[STALL WATCHDOG] Process killed due to 45 seconds of inactivity.';
        if (isPrompt) {
          bgTask.output += ' Detected possible interactive prompt. You MUST retry with non-interactive flags (e.g., -y).';
        }
        child.kill('SIGKILL');
      }
    }, 5000);

    child.stdout.on('data', (data) => {
      lastOutputTime = Date.now();
      bgTask.output += data.toString();
      this.onEvent('background_tasks_update', { tasks: this.backgroundTasks });
    });

    child.stderr.on('data', (data) => {
      lastOutputTime = Date.now();
      bgTask.output += data.toString();
      this.onEvent('background_tasks_update', { tasks: this.backgroundTasks });
    });

    child.on('close', (code) => {
      clearInterval(stallCheckInterval);
      clearTimeout(timeoutHandle);
      bgTask.status = code === 0 ? 'completed' : (code === null ? 'failed (timeout)' : 'failed');
      bgTask.exitCode = code;
      bgTask.completedAt = new Date().toISOString();

      const notification = `<task_notification>
  <task_id>${bgTask.id}</task_id>
  <status>${bgTask.status}</status>
  <command>${bgTask.command}</command>
  <summary>${bgTask.output.slice(-300) || 'No output'}</summary>
</task_notification>`;

      this.pendingNotifications.push(notification);
      this.onEvent('background_tasks_update', { tasks: this.backgroundTasks });
      this.saveSession();
    });

    child.on('error', (err) => {
      clearInterval(stallCheckInterval);
      clearTimeout(timeoutHandle);
      bgTask.status = 'failed';
      bgTask.output += `\n[LAUNCH ERROR] ${err.message}`;
      bgTask.completedAt = new Date().toISOString();

      const notification = `<task_notification>
  <task_id>${bgTask.id}</task_id>
  <status>failed</status>
  <command>${bgTask.command}</command>
  <summary>Launch error: ${err.message}</summary>
</task_notification>`;

      this.pendingNotifications.push(notification);
      this.onEvent('background_tasks_update', { tasks: this.backgroundTasks });
      this.saveSession();
    });
  }
}
