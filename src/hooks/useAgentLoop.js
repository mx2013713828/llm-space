import { useState, useEffect, useRef } from 'react';
import { estimateTokens } from '../lib/messageBuilder.js';
import { parseFeatures } from '../lib/FeatureSchema.js';
import { createCacheStats, accumulateCacheStats } from '../lib/cacheStats.js';
import { shouldSubmitMessage } from '../lib/chatInput.js';
import { fetchHarnessSession } from '../lib/sessionApi.js';
import { isOrchestrationEnabled } from '../lib/taskOrchestration.js';
import {
  isAgentDoneEvent,
  shouldApplyActiveSessionSnapshot,
} from '../lib/agentRunCompletion.js';
import {
  applyStreamMessageEvent,
  createStreamMessageState,
} from '../lib/streamMessageUpdates.js';
import { createStreamEventBatcher } from '../lib/streamEventBatcher.js';
import {
  applyRunEvent,
  applySessionSnapshotToRunState,
  createRunViewModelState,
} from '../lib/runViewModel.js';

/**
 * useAgentLoop — Agent 循环引擎 Hook
 *
 * 封装了主 Agent Loop 和 Sub-Agent Loop 的核心逻辑，
 * 包括 SSE 流式解析、工具执行（串行/并行）、上下文压缩和 TODO 看板集成。
 *
 * @param {Object} params
 * @param {Object} params.harness - 当前 Harness 配置
 * @param {Object} params.savedSession - 已保存的 Session 数据
 * @param {Object|null} params.selectedModel - 当前选中的模型
 * @param {number} params.temperature - Temperature 参数
 * @param {number} params.maxTokens - Max Tokens 参数
 * @param {boolean} params.thinkingEnabled - 是否启用思维链
 * @param {string} params.systemPrompt - System Prompt
 * @param {Function} params.onSessionUpdate - Session 更新回调
 * @param {Function} params.onSessionReset - Session 重置回调
 */
export function useAgentLoop({
  harness,
  savedSession,
  selectedModel,
  temperature,
  maxTokens,
  thinkingEnabled,
  systemPrompt,
  onSessionUpdate,
  onSessionReset,
}) {
  const [messages, setMessages] = useState([]);
  const [todos, setTodos] = useState([]);
  const [backgroundTasks, setBackgroundTasks] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [cacheStats, setCacheStats] = useState(() => createCacheStats());
  const [contextTokens, setContextTokens] = useState(0);
  const [pendingPermission, setPendingPermission] = useState(null);

  const textareaRef = useRef(null);
  const isComposingRef = useRef(false);
  const [inputText, setInputText] = useState('');
  const parsedFeatures = parseFeatures(harness?.features || {});

  // Track last reported content to avoid triggering onSessionUpdate unnecessarily
  const lastReportedRef = useRef({ messages: null, todos: null, backgroundTasks: null });

  // Sync local state up to parent — only when content actually changes
  useEffect(() => {
    if (!onSessionUpdate) return;
    if (isRunning) return;
    const newMsgStr = JSON.stringify(messages);
    const newTodoStr = JSON.stringify(todos);
    const newBgStr = JSON.stringify(backgroundTasks);
    const same = lastReportedRef.current.messages === newMsgStr && 
                 lastReportedRef.current.todos === newTodoStr &&
                 lastReportedRef.current.backgroundTasks === newBgStr;
    if (same) {
      return; // Skip if content is identical to last report
    }
    lastReportedRef.current.messages = newMsgStr;
    lastReportedRef.current.todos = newTodoStr;
    lastReportedRef.current.backgroundTasks = newBgStr;
    onSessionUpdate(messages, todos, backgroundTasks);
  }, [messages, todos, backgroundTasks, isRunning]);

  // Synchronize local messages and todos state when external savedSession changes.
  // After updating local state, pre-populate lastReportedRef so that the A effect
  // (onSessionUpdate reporter) treats this as "already reported" and skips the
  // onSessionUpdate call — this breaks the cycle:
  //   B sets messages → A fires → onSessionUpdate → setSessions → savedSession ref changes → B fires...
  const lastSavedSessionRef = useRef(null);
  const liveStateRef = useRef({ messages: [], todos: [], backgroundTasks: [] });
  const lastStreamEventAtRef = useRef(0);
  const streamMessageStatesRef = useRef(new Map());
  const streamBatcherRef = useRef(null);
  const runViewModelRef = useRef(createRunViewModelState());
  useEffect(() => {
    liveStateRef.current = { messages, todos, backgroundTasks };
  }, [messages, todos, backgroundTasks]);

  const applySessionSnapshot = (session, { markReported = true, phase = 'done' } = {}) => {
    const nextRunState = applySessionSnapshotToRunState(
      runViewModelRef.current || createRunViewModelState(liveStateRef.current),
      session,
      { phase },
    );
    runViewModelRef.current = nextRunState;
    const snapshot = {
      messages: nextRunState.messages,
      todos: nextRunState.todos,
      backgroundTasks: nextRunState.backgroundTasks,
    };
    liveStateRef.current = snapshot;
    lastSavedSessionRef.current = JSON.stringify(snapshot);
    if (markReported) {
      lastReportedRef.current.messages = JSON.stringify(snapshot.messages);
      lastReportedRef.current.todos = JSON.stringify(snapshot.todos);
      lastReportedRef.current.backgroundTasks = JSON.stringify(snapshot.backgroundTasks);
    } else {
      lastReportedRef.current.messages = null;
      lastReportedRef.current.todos = null;
      lastReportedRef.current.backgroundTasks = null;
    }
    setMessages(snapshot.messages);
    setTodos(snapshot.todos);
    setBackgroundTasks(snapshot.backgroundTasks);
  };

  useEffect(() => {
    if (isRunning) return; // Skip updating during active run to avoid race condition with stream delta

    const incoming = savedSession
      ? { 
          messages: savedSession.messages || [], 
          todos: savedSession.todos || [],
          backgroundTasks: savedSession.backgroundTasks || []
        }
      : { 
          messages: harness?.trajectory || [], 
          todos: harness?.todos || [],
          backgroundTasks: []
        };

    const incomingStr = JSON.stringify(incoming);
    const same = lastSavedSessionRef.current === incomingStr;
    if (same) return; // No actual change
    lastSavedSessionRef.current = incomingStr;

    // Pre-fill lastReportedRef BEFORE calling setMessages/setTodos.
    // This prevents the A effect from seeing these state changes as "new user-generated
    // content" and calling onSessionUpdate, which would trigger setSessions → savedSession
    // ref changes → this effect again → infinite loop.
    lastReportedRef.current.messages = JSON.stringify(incoming.messages);
    lastReportedRef.current.todos = JSON.stringify(incoming.todos);
    lastReportedRef.current.backgroundTasks = JSON.stringify(incoming.backgroundTasks);
    runViewModelRef.current = createRunViewModelState(incoming);

    setMessages(incoming.messages);
    setTodos(incoming.todos);
    setBackgroundTasks(incoming.backgroundTasks);
  }, [savedSession, harness, isRunning]);

  useEffect(() => {
    if (!isRunning || !harness?.id) return undefined;
    let cancelled = false;

    const reconcileActiveRunSession = async () => {
      try {
        const session = await fetchHarnessSession(harness.id);
        if (cancelled || !session) return;
        if (!shouldApplyActiveSessionSnapshot(liveStateRef.current, session, {
          now: Date.now(),
          lastStreamAt: lastStreamEventAtRef.current,
        })) return;
        applySessionSnapshot(session, { phase: 'active' });
      } catch (err) {
        if (!cancelled) console.warn('Failed to reconcile active agent session:', err);
      }
    };

    const timer = setInterval(reconcileActiveRunSession, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isRunning, harness?.id]);

  const cronSchedulerEnabled = isOrchestrationEnabled(parsedFeatures.task_orchestration, 'enable_cron_scheduler');
  useEffect(() => {
    if (!cronSchedulerEnabled || !harness?.id || isRunning) return undefined;

    let cancelled = false;
    const syncScheduledMessages = async () => {
      try {
        const session = await fetchHarnessSession(harness.id);
        if (cancelled || !session) return;

        const incoming = {
          messages: session.messages || [],
          todos: session.todos || [],
          backgroundTasks: session.backgroundTasks || []
        };
        const incomingStr = JSON.stringify(incoming);
        if (lastSavedSessionRef.current === incomingStr) return;

        lastSavedSessionRef.current = incomingStr;
        lastReportedRef.current.messages = JSON.stringify(incoming.messages);
        lastReportedRef.current.todos = JSON.stringify(incoming.todos);
        lastReportedRef.current.backgroundTasks = JSON.stringify(incoming.backgroundTasks);
        runViewModelRef.current = createRunViewModelState(incoming);
        setMessages(incoming.messages);
        setTodos(incoming.todos);
        setBackgroundTasks(incoming.backgroundTasks);
      } catch (err) {
        if (!cancelled) console.error('Failed to sync scheduled messages:', err);
      }
    };

    syncScheduledMessages();
    const timer = setInterval(syncScheduledMessages, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [cronSchedulerEnabled, harness?.id, isRunning]);

  // 按 turn 分组
  const turns = {};
  messages.forEach(msg => {
    const t = msg.turn || 1;
    if (!turns[t]) turns[t] = [];
    turns[t].push(msg);
  });
  const loopCount = Object.keys(turns).length || 0;
  const toolCallCount = messages.filter(m => m.type === 'tool_call').length;
  const thinkingCount = messages.filter(m => m.type === 'thinking').length;
  const compactionEnabled = harness.features?.context_compaction ?? true;
  const currentTokens = estimateTokens(messages, thinkingEnabled, systemPrompt, harness.tools, contextTokens, compactionEnabled);

  // ── 核心 Agent 运行引擎 (单路 SSE 事件消费) ──
  const runAgentLoop = async (currentMessages, currentTodos = todos) => {
    streamMessageStatesRef.current = new Map();
    streamBatcherRef.current?.dispose?.();
    streamBatcherRef.current = null;
    runViewModelRef.current = createRunViewModelState({
      messages: currentMessages,
      todos: currentTodos,
      backgroundTasks: liveStateRef.current.backgroundTasks,
    });

    // 追踪当前轮次号，用于错误/恢复消息的 turn 归属（避免使用魔法数字 999 产生幽灵 Step）
    let currentTurn = currentMessages.length > 0 ? Math.max(...currentMessages.map(m => m.turn || 1)) : 1;

    try {
      let persistedTeamContext = savedSession?.teamContext ?? null;
      if (harness?.id) {
        try {
          const latestSession = await fetchHarnessSession(harness.id);
          persistedTeamContext = latestSession?.teamContext ?? persistedTeamContext;
        } catch (err) {
          console.warn('Failed to refresh session before agent run:', err);
        }
      }

      const res = await fetch('http://localhost:3001/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          harnessId: harness?.id,
          messages: currentMessages,
          todos: currentTodos,
          backgroundTasks,
          teamContext: persistedTeamContext,
          systemPrompt,
          tools: harness.tools,
          features: harness.features || {},
          selectedStrategyId: parsedFeatures.task_orchestration?.strategy || 'custom',
          model: {
            name: selectedModel?.name || '',
            modelId: selectedModel?.modelId || 'claude-sonnet-4-5',
            key: selectedModel?.key || '',
            url: selectedModel?.url || 'https://api.anthropic.com'
          },
          temperature,
          maxTokens,
          thinkingEnabled,
          // enable_skills 已升级为 group 类型，需读 .enabled；向后兼容旧 boolean 格式
          skills: (() => {
            const sf = harness.features?.enable_skills;
            const enabled = typeof sf === 'boolean' ? sf : (sf?.enabled ?? true);
            return enabled ? (harness.skills || []) : [];
          })(),
        })
      });

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errorMsg = errData.error || errorMsg;
        } catch {
          /* ignore */
        }
        throw new Error(errorMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastInputTokens = 0;

      // 辅助更新消息轨：支持 parentToolCallId 的多层嵌套更新
      const updateMessages = (parentToolCallId, updater) => {
        setMessages(prev => {
          const nextMessages = !parentToolCallId ? updater(prev) : prev.map(m => {
            if (m.id === parentToolCallId) {
              return { ...m, subMessages: updater(m.subMessages || []) };
            }
            return m;
          });
          runViewModelRef.current = {
            ...(runViewModelRef.current || createRunViewModelState(liveStateRef.current)),
            messages: nextMessages,
          };
          liveStateRef.current = {
            ...liveStateRef.current,
            messages: nextMessages,
          };
          return nextMessages;
        });
      };

      const applyStreamBatch = (events) => {
        const groups = new Map();
        for (const event of events) {
          const stateKey = event.parentToolCallId || '__root__';
          if (!groups.has(stateKey)) groups.set(stateKey, []);
          groups.get(stateKey).push(event);
        }

        for (const [stateKey, group] of groups.entries()) {
          const parentToolCallId = stateKey === '__root__' ? null : stateKey;
          if (!parentToolCallId) {
            setMessages(prev => {
              let nextRunState = {
                ...(runViewModelRef.current || createRunViewModelState(liveStateRef.current)),
                messages: prev,
              };
              for (const event of group) {
                nextRunState = applyRunEvent(nextRunState, event, {
                  lastInputTokens: event._lastInputTokens || 0,
                });
              }
              runViewModelRef.current = nextRunState;
              liveStateRef.current = {
                messages: nextRunState.messages,
                todos: nextRunState.todos,
                backgroundTasks: nextRunState.backgroundTasks,
              };
              return nextRunState.messages;
            });
            continue;
          }
          updateMessages(parentToolCallId, (list) => {
            let nextList = list;
            let nextState = streamMessageStatesRef.current.get(stateKey) || createStreamMessageState();
            for (const event of group) {
              const result = applyStreamMessageEvent(nextList, nextState, event, {
                lastInputTokens: event._lastInputTokens || 0,
              });
              nextList = result.messages;
              nextState = result.state;
            }
            streamMessageStatesRef.current.set(stateKey, nextState);
            return nextList;
          });
        }
      };

      const scheduleStreamFlush = (callback) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          return { type: 'raf', id: window.requestAnimationFrame(callback) };
        }
        return { type: 'timeout', id: setTimeout(callback, 32) };
      };

      const cancelStreamFlush = (handle) => {
        if (!handle) return;
        if (handle.type === 'raf' && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(handle.id);
          return;
        }
        clearTimeout(handle.id);
      };

      const streamBatcher = createStreamEventBatcher({
        schedule: scheduleStreamFlush,
        cancel: cancelStreamFlush,
        applyBatch: applyStreamBatch,
      });
      streamBatcherRef.current = streamBatcher;

      const enqueueStreamEvent = (evt, options = {}) => {
        streamBatcher.enqueue({
          ...evt,
          _lastInputTokens: options.lastInputTokens || 0,
        });
      };

      const flushStreamEvents = () => {
        streamBatcher.flushNow();
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          let evt;
          try { evt = JSON.parse(raw); } catch { continue; }
          lastStreamEventAtRef.current = Date.now();

          if (isAgentDoneEvent(evt)) {
            flushStreamEvents();
            if (harness?.id) {
              try {
                const finalSession = await fetchHarnessSession(harness.id);
                applySessionSnapshot(finalSession, { markReported: false, phase: 'done' });
              } catch (err) {
                console.warn('Failed to refresh final session after done:', err);
              }
            }
            await reader.cancel().catch(() => {});
            return;
          }

          switch (evt.type) {
            case 'background_tasks_update':
              setBackgroundTasks(evt.tasks || []);
              break;

            case 'error_recovery_attempt':
            case 'error_recovery_fallback':
              updateMessages(evt.parentToolCallId, (list) => [
                ...list,
                {
                  role: 'system',
                  type: 'system_alert',
                  turn: evt.turn || currentTurn,
                  content: evt.message
                }
              ]);
              break;

            case 'team_inbox_auto_injected':
              updateMessages(null, (list) => [
                ...list,
                {
                  role: 'system',
                  type: 'system_alert',
                  turn: currentTurn,
                  content: `Team inbox auto-injected ${evt.messageCount || 0} message(s) for ${evt.agentId || 'lead'} via ${evt.source || 'preLLM'}.`
                }
              ]);
              break;

            case 'permission_request':
              setPendingPermission({
                toolCallId: evt.toolCallId,
                toolName: evt.toolName,
                toolInput: evt.toolInput,
                reason: evt.reason
              });
              break;

            case 'messages_update':
              // 接收后端触发的上下文压缩或历史变更
              flushStreamEvents();
              applySessionSnapshot({
                messages: evt.messages,
                todos: liveStateRef.current.todos,
                backgroundTasks: liveStateRef.current.backgroundTasks,
              }, { phase: 'active' });
              break;

            case 'todo_update':
              // 看板状态变更同步
              setTodos(evt.todos);
              break;

            case 'sub_agent_status':
              updateMessages(null, (list) => {
                return list.map(m => {
                  if (m.id === evt.id) {
                    return {
                      ...m,
                      subAgentStatus: {
                        ...(m.subAgentStatus || {}),
                        status: evt.status,
                        phase: evt.phase,
                        currentAction: evt.currentAction,
                        currentTool: evt.currentTool,
                        toolCount: evt.toolCount,
                        previewTruncated: evt.previewTruncated,
                        startedAt: evt.startedAt,
                        completedAt: evt.completedAt,
                      }
                    };
                  }
                  return m;
                });
              });
              break;

            case 'sub_agent_trace_ready':
              updateMessages(null, (list) => {
                return list.map(m => {
                  if (m.id === evt.id) {
                    return {
                      ...m,
                      subAgentStatus: {
                        ...(m.subAgentStatus || {}),
                        status: evt.status,
                        phase: evt.phase,
                        currentAction: evt.currentAction,
                        finalPreview: evt.finalPreview,
                        toolCount: evt.toolCount,
                        startedAt: evt.startedAt,
                        completedAt: evt.completedAt,
                      },
                      subAgentTrace: evt.trace,
                    };
                  }
                  return m;
                });
              });
              break;

            case 'team_update':
              updateMessages(null, (list) => {
                return list.map(m => {
                  if (m.type !== 'tool_call' || m.toolName !== 'spawn_teammate') {
                    return m;
                  }

                  let outputTeamId = null;
                  try {
                    outputTeamId = m.toolOutput ? JSON.parse(m.toolOutput).teamId : null;
                  } catch {
                    // Keep null when the tool output is still streaming or not JSON yet.
                  }

                  const inputName = m.toolInput?.name;
                  const matchesTeam = outputTeamId && outputTeamId === evt.teamId;
                  const matchesPendingSpawn = !outputTeamId
                    && inputName
                    && (evt.teammates || []).some(teammate => teammate.name === inputName || teammate.agentId === `teammate_${inputName}`);

                  if (!matchesTeam && !matchesPendingSpawn) {
                    return m;
                  }

                  return {
                    ...m,
                    teamStatus: {
                      teamId: evt.teamId,
                      teammates: evt.teammates || [],
                    },
                  };
                });
              });
              break;

            case 'message_start':
              lastInputTokens = evt.inputTokens || 0;
              setContextTokens(evt.totalInputTokens ?? (
                (evt.inputTokens || 0) +
                (evt.cacheReadTokens || 0) +
                (evt.cacheCreationTokens || 0)
              ));
              setCacheStats(prev => accumulateCacheStats(prev, evt));
              break;

            case 'thinking_start':
              // 更新轮次追踪器，确保后续错误消息归属到正确的 Step
              if (evt.turn) currentTurn = evt.turn;
              enqueueStreamEvent(evt, { lastInputTokens });
              break;

            case 'thinking_delta':
              enqueueStreamEvent(evt);
              break;

            case 'thinking_end':
              enqueueStreamEvent(evt);
              break;

            case 'text_start':
              enqueueStreamEvent(evt, { lastInputTokens });
              break;

            case 'text_delta':
              enqueueStreamEvent(evt);
              break;

            case 'text_end':
              enqueueStreamEvent(evt);
              break;

            case 'tool_start':
              enqueueStreamEvent(evt);
              break;

            case 'tool_input_delta':
              enqueueStreamEvent(evt);
              break;

            case 'tool_end':
              enqueueStreamEvent(evt);
              break;

            case 'tool_exec_start':
              enqueueStreamEvent(evt);
              break;

            case 'tool_exec_chunk':
              enqueueStreamEvent(evt);
              break;

            case 'tool_exec_invalid':
              enqueueStreamEvent(evt);
              break;

            case 'tool_exec_done':
              enqueueStreamEvent(evt);
              break;

            case 'message_delta':
              enqueueStreamEvent(evt);
              break;

            case 'error':
              // 处理流式传输中后端的 error 事件
              flushStreamEvents();
              setMessages(prev => [
                ...prev,
                {
                  role: 'assistant',
                  type: 'text',
                  turn: currentTurn,
                  content: evt.suggestion 
                    ? `❌ **Request Error**: ${evt.message}\n\n💡 **Troubleshooting & Debugging Suggestions**:\n${evt.suggestion}`
                    : `❌ **Request Error**: ${evt.message}`
                }
              ]);
              break;
          }
        }
      }
    } catch (err) {
      console.error(err);
      streamBatcherRef.current?.flushNow?.();
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          type: 'text',
          turn: currentTurn,
          content: `❌ **Network or Runtime Exception**\n\n${err.message}`
        }
      ]);
    } finally {
      streamBatcherRef.current?.flushNow?.();
      streamBatcherRef.current?.dispose?.();
      streamBatcherRef.current = null;
      setIsRunning(false);
    }
  };

  // Detect background agent state and auto-attach to scheduled executions.
  useEffect(() => {
    if (!harness?.id || isRunning) return undefined;
    let cancelled = false;

    const attachIfRunning = async () => {
      try {
        const res = await fetch(`http://localhost:3001/api/agent/status/${harness.id}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.pendingPermission) {
          setPendingPermission(data.pendingPermission);
        } else {
          setPendingPermission(null);
        }
        if (data.backgroundTasks) {
          setBackgroundTasks(data.backgroundTasks);
        }
        if (data.isRunning) {
          console.log(`🔌 Background task found for ${harness.id}, auto attaching...`);
          setIsRunning(true);
          const latestMessages = savedSession?.messages || harness?.trajectory || [];
          const latestTodos = savedSession?.todos || harness?.todos || [];
          runAgentLoop(latestMessages, latestTodos);
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch running status:', err);
      }
    };

    attachIfRunning();
    const timer = setInterval(attachIfRunning, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [harness?.id, isRunning]);

  /** 处理发送消息 */
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isRunning) return;
    if (!selectedModel || !selectedModel.key) return alert('Please select or configure a model with an API Key first!');

    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = '44px';
    setIsRunning(true);

    const nextTurn = loopCount + 1;
    const userMsg = { role: 'user', content: text, turn: nextTurn };
    const currentMessages = [...messages, userMsg];

    setMessages(currentMessages);
    setContextTokens(0);

    // Pass current todos as second arg (was incorrectly passing nextTurn number before)
    await runAgentLoop(currentMessages, todos);
    // Note: setIsRunning(false) is handled in runAgentLoop's finally block
  };

  /** 处理输入框变化 */
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  };

  /** 处理按键事件 */
  const handleKeyDown = (e) => {
    if (shouldSubmitMessage(e, isComposingRef.current)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleCompositionStart = () => {
    isComposingRef.current = true;
  };

  const handleCompositionEnd = () => {
    isComposingRef.current = false;
  };

  /** 重置 Session */
  const handleResetSession = () => {
    if (window.confirm("Clearing session will permanently delete the execution history for this Harness. Are you sure?")) {
      setMessages([]);
      setTodos([]);
      setPendingPermission(null);
      setContextTokens(0);
      setCacheStats(createCacheStats()); // 修复：重置缓存统计，避免旧数据残留到新 session
      if (onSessionReset) onSessionReset();
    }
  };

  /** 回滚并重试指定轮次 */
  const handleRetryTurn = (turnNum, originalText) => {
    if (isRunning) return; // 运行中禁止回滚
    if (window.confirm(`Are you sure you want to rewind to turn ${turnNum}? The message history of this and subsequent turns will be permanently erased.`)) {
      // 1. 剪枝消息：只保留 turn 小于 turnNum 的消息
      setMessages(prev => prev.filter(m => (m.turn || 1) < turnNum));
      // 2. 将原文本重新填入输入框
      setInputText(originalText);
      // 3. 聚焦输入框
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }, 50);
    }
  };

  /** 提交审批决定 */
  const handlePermissionDecision = async (toolCallId, decision) => {
    try {
      const res = await fetch('http://localhost:3001/api/agent/permission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolCallId,
          decision
        })
      });
      if (res.ok) {
        setPendingPermission(null);
      } else {
        const data = await res.json();
        alert(`Security approval failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Approval network exception: ${err.message}`);
    }
  };

  return {
    // 消息和状态
    messages,
    todos,
    backgroundTasks,
    turns,
    loopCount,
    toolCallCount,
    thinkingCount,
    isRunning,
    currentTokens,
    cacheStats,
    contextTokens,
    pendingPermission,

    // 输入控制
    inputText,
    setInputText,
    textareaRef,
    handleInputChange,
    handleKeyDown,
    handleCompositionStart,
    handleCompositionEnd,
    handleSend,

    // Session 管理
    handleResetSession,
    handleRetryTurn,
    handlePermissionDecision,
  };
}

export const getInitialFeatures = () => {
  return parseFeatures(undefined);
};
