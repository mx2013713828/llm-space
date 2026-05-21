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

  // 估算的 Token 数
  const currentTokens = estimateTokens(messages, thinkingEnabled, systemPrompt, harness.tools, contextTokens);

  // ── 核心 Sub-Agent Loop（独立的子环境） ──
  const runSubAgentLoop = async (prompt, tool, updateLatestMsg) => {
    let subMessages = [{ role: 'user', content: prompt }];
    tool.subMessages = subMessages;
    updateLatestMsg();

    const subTools = harness.tools.filter(t => t.name !== 'sub_agent');

    for (let i = 0; i < 15; i++) {
      let apiMessages = buildApiMessages(subMessages, thinkingEnabled);

      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          system: "你是一个子代理（Sub-agent）。请根据用户的具体任务，利用工具完成研究或操作。完成任务后，请输出最终的总结报告。请尽力而为，如果尝试多次失败也请如实报告。",
          tools: subTools,
          model: selectedModel?.modelId || 'claude-sonnet-4-5',
          apiKey: selectedModel?.key || '',
          baseUrl: selectedModel?.url || 'https://api.anthropic.com',
          temperature,
          maxTokens,
          thinkingEnabled,
        })
      });

      if (!res.ok) throw new Error('Sub-agent API request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
          let evt; try { evt = JSON.parse(line.slice(6)); } catch { continue; }
          switch (evt.type) {
            case 'thinking_start':
              currentMsg = { role: 'assistant', type: 'thinking', turn: i + 1, content: '', tokens: { input: 0, output: 0 } };
              subMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'thinking_delta':
              if (currentMsg) { currentMsg.content += evt.text || ''; updateLatestMsg(); }
              break;
            case 'text_start':
              currentMsg = { role: 'assistant', type: 'text', turn: i + 1, content: '', tokens: { input: 0, output: 0 } };
              subMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'text_delta':
              if (currentMsg) { currentMsg.content += evt.text || ''; updateLatestMsg(); }
              break;
            case 'tool_start':
              currentMsg = { role: 'assistant', type: 'tool_call', turn: i + 1, id: evt.id, toolName: evt.name, toolInputRaw: '', toolInput: {} };
              subMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'tool_input_delta':
              if (currentMsg && currentMsg.type === 'tool_call') {
                currentMsg.toolInputRaw += evt.partial;
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch { /* ignore */ }
                updateLatestMsg();
              }
              break;
            case 'tool_end':
              updateLatestMsg();
              break;
            case 'stop':
              stopReason = evt.stopReason;
              break;
          }
        }
      }

      if (stopReason === 'tool_use') {
        const toolsToRun = subMessages.filter(m => m.turn === i + 1 && m.type === 'tool_call');
        for (const subTool of toolsToRun) {
          if (subTool.toolName === 'write_todos') {
            subTool.toolOutput = "[系统拦截] 子代理被禁止修改全局 TODO 看板。";
            updateLatestMsg();
            continue;
          }
          try {
            const execRes = await fetch('http://localhost:3001/api/execute-tool', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ toolName: subTool.toolName, toolInput: subTool.toolInput })
            });
            const reader = execRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                  const chunkEvt = JSON.parse(line.slice(6));
                  if (chunkEvt.type === 'chunk') { subTool.toolOutput = (subTool.toolOutput || '') + chunkEvt.content; updateLatestMsg(); }
                  else if (chunkEvt.type === 'done') { subTool.toolOutput = String(chunkEvt.output); }
                  else if (chunkEvt.type === 'error') { subTool.toolOutput = `[错误] ${chunkEvt.message}`; }
                } catch (e) { /* ignore */ }
              }
            }
          } catch (e) { subTool.toolOutput = `[错误] ${e.message}`; }
          updateLatestMsg();
        }
      } else {
        const textBlocks = subMessages.filter(m => m.type === 'text').map(m => m.content);
        return textBlocks.length > 0 ? textBlocks.join('') : "(子代理未返回任何文字总结)";
      }
    }
    return "子代理运行超过最大轮次 (15)，被迫终止。";
  };

  // ── 核心 Agent Loop（递归执行） ──
  const runAgentLoop = async (currentMessages, turnIndex, roundsSinceTodo = 0) => {
    let activeMessages = currentMessages;

    // 阶段二：Soft Compact Epoch
    const compactResult = compactMessages(activeMessages, turnIndex, currentTokens, systemPrompt, harness.tools, thinkingEnabled);
    if (compactResult.compactedCount > 0) {
      activeMessages = compactResult.messages;
      setMessages(activeMessages);
      if (compactResult.estimatedTokens != null) {
        setContextTokens(compactResult.estimatedTokens);
      }
    }

    let apiMessages = buildApiMessages(activeMessages, thinkingEnabled);

    // 注入 TODO 看板状态和催促机制
    apiMessages = injectTodoState(apiMessages, todos, roundsSinceTodo);

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          system: systemPrompt,
          tools: harness.tools,
          model: selectedModel?.modelId || 'claude-sonnet-4-5',
          apiKey: selectedModel?.key || '',
          baseUrl: selectedModel?.url || 'https://api.anthropic.com',
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
        } catch (e) { /* ignore */ }
        throw new Error(errorMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentMsg = null;
      let stopReason = null;
      let newMessages = [...activeMessages];
      let hasUpdatedTodoThisTurn = false;

      const updateLatestMsg = () => setMessages([...newMessages]);

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
            case 'error':
              newMessages.push({ role: 'assistant', type: 'text', turn: turnIndex, content: `[API 返回错误]: ${evt.message}` });
              updateLatestMsg();
              break;
            case 'message_start':
              if (evt.inputTokens) {
                window._lastInputTokens = evt.inputTokens;
                setContextTokens(evt.inputTokens);
              }
              if (evt.cacheReadTokens !== undefined) {
                setCacheStats(prev => ({
                  hitTokens: prev.hitTokens + (evt.cacheReadTokens || 0),
                  missTokens: prev.missTokens + (evt.inputTokens || 0),
                }));
              }
              break;
            case 'thinking_start':
              currentMsg = {
                role: 'assistant',
                type: 'thinking',
                turn: turnIndex,
                content: '',
                tokens: { input: window._lastInputTokens || 0, output: 0 },
                signature: evt.signature
              };
              newMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'thinking_delta':
              if (currentMsg) {
                currentMsg.content += evt.text || '';
                updateLatestMsg();
              }
              break;
            case 'message_delta':
              if (evt.inputTokens) {
                setContextTokens(evt.inputTokens);
              }
              if (currentMsg && evt.outputTokens) {
                currentMsg.tokens = { ...currentMsg.tokens, output: evt.outputTokens };
                updateLatestMsg();
              }
              break;
            case 'text_start':
              currentMsg = {
                role: 'assistant',
                type: 'text',
                turn: turnIndex,
                content: '',
                tokens: { input: window._lastInputTokens || 0, output: 0 }
              };
              newMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'text_delta':
              if (currentMsg) {
                currentMsg.content += evt.text || '';
                updateLatestMsg();
              }
              break;
            case 'tool_start':
              currentMsg = { role: 'assistant', type: 'tool_call', turn: turnIndex, id: evt.id, toolName: evt.name, toolInputRaw: '', toolInput: {} };
              newMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'tool_input_delta':
              if (currentMsg && currentMsg.type === 'tool_call') {
                currentMsg.toolInputRaw += evt.partial;
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch { /* ignore */ }
                updateLatestMsg();
              }
              break;
            case 'tool_end':
              updateLatestMsg();
              break;
            case 'stop':
              stopReason = evt.stopReason;
              break;
          }
        }
      }

      if (stopReason === 'tool_use') {
        const toolsToRun = newMessages.filter(m => m.turn === turnIndex && m.type === 'tool_call');

        const executeToolCall = async (tool) => {
          if (tool.toolName === 'sub_agent' && tool.toolInput?.prompt) {
            try {
              tool.toolOutput = await runSubAgentLoop(tool.toolInput.prompt, tool, updateLatestMsg);
            } catch (err) {
              tool.toolOutput = `[子代理异常崩溃]\n${err.message}`;
            }
          } else if (tool.toolName === 'write_todos' && tool.toolInput?.todos) {
            setTodos(tool.toolInput.todos);
            hasUpdatedTodoThisTurn = true;

            // 优化：返回更详细的 tool_result
            const counts = {
              pending: tool.toolInput.todos.filter(t => t.status === 'pending').length,
              completed: tool.toolInput.todos.filter(t => t.status === 'completed').length,
            };
            tool.toolOutput = `[系统] 已更新看板。当前进度: ${counts.completed}/${tool.toolInput.todos.length} 已完成。`;
          } else {
            try {
              const execRes = await fetch('http://localhost:3001/api/execute-tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: tool.toolName, toolInput: tool.toolInput })
              });

              if (!execRes.ok) throw new Error('网络请求失败');

              const reader = execRes.body.getReader();
              const decoder = new TextDecoder();
              let buffer = '';

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue;
                  try {
                    const evt = JSON.parse(line.slice(6));
                    if (evt.type === 'chunk') {
                      tool.toolOutput = (tool.toolOutput || '') + evt.content;
                      updateLatestMsg(); // 实时触发 UI 刷新
                    } else if (evt.type === 'done') {
                      tool.toolOutput = String(evt.output);
                    } else if (evt.type === 'error') {
                      tool.toolOutput = `[错误] ${evt.message}`;
                    }
                  } catch (e) { /* ignore */ }
                }
              }
            } catch (err) {
              tool.toolOutput = `[工具执行错误]\n${err.message}`;
            }
          }
          updateLatestMsg();
        };

        const isParallel = harness.features?.parallel_tool_execution === true;

        if (isParallel) {
          await Promise.all(toolsToRun.map(executeToolCall));
        } else {
          for (const tool of toolsToRun) {
            await executeToolCall(tool);
          }
        }

        await new Promise(r => setTimeout(r, 500));
        // 递归调用，传递更新后的计数器
        await runAgentLoop(newMessages, turnIndex, hasUpdatedTodoThisTurn ? 0 : roundsSinceTodo + 1);
      }

    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, { role: 'assistant', type: 'text', turn: turnIndex, content: `❌ **请求失败**\n\n${err.message}` }]);
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
  };
}
