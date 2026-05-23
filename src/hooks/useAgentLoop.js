import { useState, useEffect, useRef } from 'react';
import { buildApiMessages, compactMessages, estimateTokens, injectTodoState } from '../lib/messageBuilder.js';

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
  const [messages, setMessages] = useState(savedSession?.messages || harness.trajectory || []);
  const [todos, setTodos] = useState(savedSession?.todos || harness.todos || []);
  const [isRunning, setIsRunning] = useState(false);
  const [cacheStats, setCacheStats] = useState({ hitTokens: 0, missTokens: 0 });
  const [contextTokens, setContextTokens] = useState(0);

  const textareaRef = useRef(null);
  const [inputText, setInputText] = useState('');

  // 同步状态到上层
  useEffect(() => {
    if (onSessionUpdate) {
      onSessionUpdate(messages, todos);
    }
  }, [messages, todos]);

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
  const compactionEnabled = harness.features?.context_compaction !== false;
  const currentTokens = estimateTokens(messages, thinkingEnabled, systemPrompt, harness.tools, contextTokens, compactionEnabled);

  // ── 核心 Agent 运行引擎 (单路 SSE 事件消费) ──
  const runAgentLoop = async (currentMessages) => {
    try {
      const res = await fetch('http://localhost:3001/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: currentMessages,
          todos,
          systemPrompt,
          tools: harness.tools,
          features: harness.features || {},
          model: {
            name: selectedModel?.name || '',
            modelId: selectedModel?.modelId || 'claude-sonnet-4-5',
            key: selectedModel?.key || '',
            url: selectedModel?.url || 'https://api.anthropic.com'
          },
          temperature,
          maxTokens,
          thinkingEnabled,
        })
      });

      if (!res.ok) {
        let errorMsg = `HTTP ${res.status}`;
        try {
          const errData = await res.json();
          errorMsg = errData.error || errorMsg;
        } catch (e) { }
        throw new Error(errorMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let lastInputTokens = 0;

      // 辅助更新消息轨：支持 parentToolCallId 的多层嵌套更新
      const updateMessages = (parentToolCallId, updater) => {
        setMessages(prev => {
          if (!parentToolCallId) return updater(prev);
          return prev.map(m => {
            if (m.id === parentToolCallId) {
              return { ...m, subMessages: updater(m.subMessages || []) };
            }
            return m;
          });
        });
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

          switch (evt.type) {
            case 'messages_update':
              // 接收后端触发的上下文压缩或历史变更
              setMessages(evt.messages);
              break;

            case 'todo_update':
              // 看板状态变更同步
              setTodos(evt.todos);
              break;

            case 'message_start':
              lastInputTokens = evt.inputTokens || 0;
              setContextTokens((evt.inputTokens || 0) + (evt.cacheReadTokens || 0));
              setCacheStats(prev => ({
                hitTokens: prev.hitTokens + (evt.cacheReadTokens || 0),
                missTokens: prev.missTokens + (evt.inputTokens || 0),
              }));
              break;

            case 'thinking_start':
              updateMessages(evt.parentToolCallId, (list) => [
                ...list,
                {
                  role: 'assistant',
                  type: 'thinking',
                  turn: evt.turn,
                  content: '',
                  tokens: { input: lastInputTokens, output: 0 },
                  signature: evt.signature
                }
              ]);
              break;

            case 'thinking_delta':
              updateMessages(evt.parentToolCallId, (list) => {
                let targetIdx = -1;
                for (let i = list.length - 1; i >= 0; i--) {
                  if (list[i].role === 'assistant' && list[i].type === 'thinking') {
                    targetIdx = i;
                    break;
                  }
                }
                if (targetIdx === -1) return list;
                return list.map((item, idx) =>
                  idx === targetIdx
                    ? { ...item, content: item.content + (evt.text || '') }
                    : item
                );
              });
              break;

            case 'text_start':
              updateMessages(evt.parentToolCallId, (list) => [
                ...list,
                {
                  role: 'assistant',
                  type: 'text',
                  turn: evt.turn,
                  content: '',
                  tokens: { input: lastInputTokens, output: 0 }
                }
              ]);
              break;

            case 'text_delta':
              updateMessages(evt.parentToolCallId, (list) => {
                let targetIdx = -1;
                for (let i = list.length - 1; i >= 0; i--) {
                  if (list[i].role === 'assistant' && list[i].type === 'text') {
                    targetIdx = i;
                    break;
                  }
                }
                if (targetIdx === -1) return list;
                return list.map((item, idx) =>
                  idx === targetIdx
                    ? { ...item, content: item.content + (evt.text || '') }
                    : item
                );
              });
              break;

            case 'tool_start':
              updateMessages(evt.parentToolCallId, (list) => [
                ...list,
                {
                  role: 'assistant',
                  type: 'tool_call',
                  turn: evt.turn,
                  id: evt.id,
                  toolName: evt.name,
                  toolInputRaw: '',
                  toolInput: {}
                }
              ]);
              break;

            case 'tool_input_delta':
              updateMessages(evt.parentToolCallId, (list) => {
                let targetIdx = -1;
                for (let i = list.length - 1; i >= 0; i--) {
                  if (list[i].role === 'assistant' && list[i].type === 'tool_call') {
                    targetIdx = i;
                    break;
                  }
                }
                if (targetIdx === -1) return list;
                return list.map((item, idx) => {
                  if (idx === targetIdx) {
                    const newRaw = item.toolInputRaw + evt.partial;
                    let parsed = { ...item.toolInput };
                    try { parsed = JSON.parse(newRaw); } catch { }
                    return { ...item, toolInputRaw: newRaw, toolInput: parsed };
                  }
                  return item;
                });
              });
              break;

            case 'tool_end':
              updateMessages(evt.parentToolCallId, (list) => {
                let targetIdx = -1;
                for (let i = list.length - 1; i >= 0; i--) {
                  if (list[i].role === 'assistant' && list[i].type === 'tool_call') {
                    targetIdx = i;
                    break;
                  }
                }
                if (targetIdx === -1) return list;
                return list.map((item, idx) => {
                  if (idx === targetIdx) {
                    return { ...item, toolInput: evt.input || item.toolInput };
                  }
                  return item;
                });
              });
              break;

            case 'tool_exec_chunk':
              updateMessages(evt.parentToolCallId, (list) => {
                return list.map(m => {
                  if (m.id === evt.id) {
                    return { ...m, toolOutput: (m.toolOutput || '') + evt.content };
                  }
                  return m;
                });
              });
              break;

            case 'tool_exec_done':
              updateMessages(evt.parentToolCallId, (list) => {
                return list.map(m => {
                  if (m.id === evt.id) {
                    return { ...m, toolOutput: String(evt.output) };
                  }
                  return m;
                });
              });
              break;

            case 'message_delta':
              updateMessages(evt.parentToolCallId, (list) => {
                if (list.length === 0) return list;
                const targetIdx = list.length - 1;
                return list.map((item, idx) => {
                  if (idx === targetIdx && item.role === 'assistant' && evt.outputTokens) {
                    return {
                      ...item,
                      tokens: { ...item.tokens, output: evt.outputTokens }
                    };
                  }
                  return item;
                });
              });
              break;

            case 'error':
              // 处理流式传输中后端的 error 事件
              setMessages(prev => [
                ...prev,
                {
                  role: 'assistant',
                  type: 'text',
                  turn: 999,
                  content: `❌ **请求错误**: ${evt.message}`
                }
              ]);
              break;
          }
        }
      }
    } catch (err) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          type: 'text',
          turn: 999,
          content: `❌ **网络或运行异常**\n\n${err.message}`
        }
      ]);
    }
  };

  /** 处理发送消息 */
  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isRunning) return;
    if (!selectedModel || !selectedModel.key) return alert('请先选择或配置包含 API Key 的模型！');

    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = '44px';
    setIsRunning(true);

    const nextTurn = loopCount + 1;
    const userMsg = { role: 'user', content: text, turn: nextTurn };
    const currentMessages = [...messages, userMsg];

    setMessages(currentMessages);
    setContextTokens(0);

    await runAgentLoop(currentMessages, nextTurn);

    setIsRunning(false);
  };

  /** 处理输入框变化 */
  const handleInputChange = (e) => {
    setInputText(e.target.value);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  };

  /** 处理按键事件 */
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /** 重置 Session */
  const handleResetSession = () => {
    if (window.confirm('确定要重置当前 Harness 的 Session（清空对话与 TODO 状态）吗？')) {
      setMessages([]);
      setTodos([]);
      setContextTokens(0);
      if (onSessionReset) onSessionReset();
    }
  };

  /** 回滚并重试指定轮次 */
  const handleRetryTurn = (turnNum, originalText) => {
    if (isRunning) return; // 运行中禁止回滚
    if (window.confirm(`确定要回滚到第 ${turnNum} 轮对话吗？此轮及之后的消息历史将被永久擦除。`)) {
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

  return {
    // 消息和状态
    messages,
    todos,
    turns,
    loopCount,
    toolCallCount,
    thinkingCount,
    isRunning,
    currentTokens,
    cacheStats,
    contextTokens,

    // 输入控制
    inputText,
    setInputText,
    textareaRef,
    handleInputChange,
    handleKeyDown,
    handleSend,

    // Session 管理
    handleResetSession,
    handleRetryTurn,
  };
}
