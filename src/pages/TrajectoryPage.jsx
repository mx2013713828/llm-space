import { useState, useRef, useEffect } from 'react';
import { ThinkingBubble, ToolCallCard, UserMessage, AssistantMessage } from '../components/MessageBubbles';
import { TodoList } from '../components/TodoList';

export function TrajectoryPage({ harness, savedSession, onSessionUpdate, onSessionReset }) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);

  useEffect(() => {
    fetch('http://localhost:3001/api/models')
      .then(r => r.json())
      .then(data => {
        setModels(data);
        if (data.length > 0) {
          const savedId = localStorage.getItem('llm_selected_model_id');
          const found = data.find(m => m.id === savedId) || data[0];
          setSelectedModel(found);
        }
      });
  }, []);

  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('llm_selected_model_id', selectedModel.id);
    }
  }, [selectedModel]);

  const [showAddModel, setShowAddModel] = useState(false);
  const [newModelConfig, setNewModelConfig] = useState({ name: '', modelId: '', url: '', key: '' });

  const handleAddModel = async () => {
    if (!newModelConfig.name || !newModelConfig.modelId || !newModelConfig.url || !newModelConfig.key) {
      alert('请填写完整模型信息');
      return;
    }
    const res = await fetch('http://localhost:3001/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newModelConfig)
    });
    const updated = await res.json();
    setModels(updated);
    setSelectedModel(updated[updated.length - 1]);
    setShowAddModel(false);
    setNewModelConfig({ name: '', modelId: '', url: '', key: '' });
  };

  // 模型参数
  const [temperature, setTemperature] = useState(harness.model.temperature || 1.0);
  const [maxTokens, setMaxTokens] = useState(harness.model.max_tokens || 8000);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt);

  // 界面状态
  const [activeRightTab, setActiveRightTab] = useState('trajectory');
  const [messages, setMessages] = useState(savedSession?.messages || harness.trajectory || []);
  const [todos, setTodos] = useState(savedSession?.todos || harness.todos || []);
  const [inputText, setInputText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [cacheStats, setCacheStats] = useState({ hitTokens: 0, missTokens: 0 });
  const [contextTokens, setContextTokens] = useState(0); // 新增 Token 计数器
  const [showContextInspector, setShowContextInspector] = useState(false); // 上下文检查器

  // 同步状态到上层
  useEffect(() => {
    if (onSessionUpdate) {
      onSessionUpdate(messages, todos);
    }
  }, [messages, todos]);

  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const scrollContainerRef = useRef(null);

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

  useEffect(() => {
    if (activeRightTab === 'trajectory') {
      setTimeout(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [messages, activeRightTab]);

  const handleInputChange = (e) => {
    setInputText(e.target.value);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /** 组装 API 历史记录 */
  /** 组装 API 历史记录 (终极修复版：严格保持顺序 + 智能块聚合 + 并行工具隔离) */
  const buildApiMessages = (sourceMessages) => {
    const apiMessages = [];
    let currentAssistantContent = [];
    let currentToolResults = [];

    for (const msg of sourceMessages) {
      if (msg.role === 'user') {
        // Flush any pending assistant content and tool results first
        if (currentAssistantContent.length > 0) {
          apiMessages.push({ role: 'assistant', content: currentAssistantContent });
          currentAssistantContent = [];
        }
        if (currentToolResults.length > 0) {
          apiMessages.push({ role: 'user', content: currentToolResults });
          currentToolResults = [];
        }

        // Add the user message
        apiMessages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
      } else if (msg.role === 'assistant') {
        // 当我们遇到非工具调用的 assistant 块（如 text/thinking），且累积了上一阶段的工具结果时，
        // 说明已经进入了 ReAct 循环的下一个 Step，必须立刻将上一步的 assistant 消息和对应的 user tool_result 消息发送出去（Flush）。
        if (msg.type !== 'tool_call' && currentToolResults.length > 0) {
          if (currentAssistantContent.length > 0) {
            apiMessages.push({ role: 'assistant', content: currentAssistantContent });
            currentAssistantContent = [];
          }
          apiMessages.push({ role: 'user', content: currentToolResults });
          currentToolResults = [];
        }

        // 添加到当前的助手消息块中
        if (msg.type === 'text') {
          currentAssistantContent.push({ type: 'text', text: msg.content });
        } else if (msg.type === 'thinking' && thinkingEnabled) {
          const b = { type: 'thinking', thinking: msg.content };
          if (msg.signature) b.signature = msg.signature;
          currentAssistantContent.push(b);
        } else if (msg.type === 'tool_call') {
          currentAssistantContent.push({ type: 'tool_use', id: msg.id, name: msg.toolName, input: msg.toolInput });
          if (msg.toolOutput != null) {
            // 阶段一：日常防护盾 (Always-On Shield) - 拦截超大文本（排除 read_file，确保当前轮次能读到完整源码）
            let outStr = String(msg.toolOutput);
            if (msg.toolName !== 'read_file' && outStr.length > 4000) {
              const head = outStr.slice(0, 1500);
              const tail = outStr.slice(-500);
              const truncatedCount = outStr.length - 2000;
              outStr = `${head}\n\n...[OUTPUT OFFLOADED - 截断了 ${truncatedCount} 个字符，如果需要中间的内容，请使用 grep 检索]...\n\n${tail}`;
            }
            currentToolResults.push({
              type: 'tool_result',
              tool_use_id: msg.id,
              content: outStr
            });
          }
        }
      }
    }

    // Flush 结尾残留的所有内容
    if (currentAssistantContent.length > 0) {
      apiMessages.push({ role: 'assistant', content: currentAssistantContent });
    }
    if (currentToolResults.length > 0) {
      apiMessages.push({ role: 'user', content: currentToolResults });
    }

    // 合并相邻的同角色消息（双重兜底防护）
    const collapsedMsgs = [];
    apiMessages.forEach(msg => {
      let last = collapsedMsgs[collapsedMsgs.length - 1];
      if (last && last.role === msg.role) {
        last.content.push(...msg.content);
      } else {
        collapsedMsgs.push(msg);
      }
    });

    return collapsedMsgs;
  };

  // 估算的 Token 数（包含：消息历史 + System Prompt + 工具 Schema，以字符数 / 4 保底，防止非 Anthropic 模型返回 0）
  const currentTokens = contextTokens > 0 
    ? contextTokens 
    : Math.round((
        JSON.stringify(buildApiMessages(messages)).length + 
        (systemPrompt || '').length + 
        JSON.stringify(harness.tools || []).length
      ) / 4);


  // ── 核心 Sub-Agent Loop（独立的子环境） ──
  const runSubAgentLoop = async (prompt, tool, updateLatestMsg) => {
    let subMessages = [{ role: 'user', content: prompt }];
    tool.subMessages = subMessages;
    updateLatestMsg();

    const subTools = harness.tools.filter(t => t.name !== 'sub_agent');

    for (let i = 0; i < 15; i++) {
      let apiMessages = buildApiMessages(subMessages);

      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          system: "你是一个子代理（Sub-agent）。请根据用户的具体任务，利用工具完成研究或操作。完成任务后，请输出最终的总结报告。请尽力而为，如果尝试多次失败也请如实报告。",
          tools: subTools,
          model: selectedModel?.modelId || 'claude-3-7-sonnet-20250219',
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
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch { }
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
                } catch (e) { }
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

    // 阶段二：80% 水位线软清洗 (Soft Compact Epoch)
    // 当 Token 超过 160k (80% of 200k) 且我们至少聊了 5 轮以上时触发
    if (currentTokens > 3000 && turnIndex > 1) {
      console.log("🌊 触发 Soft Compact Epoch，开始压缩历史...");
      let compactedCount = 0;
      activeMessages = currentMessages.map(msg => {
        // 只处理距离当前 > 5 轮的老消息
        if (turnIndex - (msg.turn || 1) <= 1) return msg;

        const newMsg = { ...msg };
        if (newMsg.type === 'thinking' && newMsg.content) {
          newMsg.content = '[已折叠旧的思考过程]';
          compactedCount++;
        } else if (newMsg.type === 'tool_call') {
          if (newMsg.toolName === 'read_file' && newMsg.toolOutput) {
            newMsg.toolOutput = '[Archived: Content is on disk, re-read if necessary]';
            compactedCount++;
          } else if (newMsg.toolName === 'write_file' && newMsg.toolInput?.content) {
            newMsg.toolInput = { ...newMsg.toolInput, content: '[Content written to disk]' };
            newMsg.toolInputRaw = JSON.stringify(newMsg.toolInput);
            compactedCount++;
          } else if (['ls', 'grep', 'web_search', 'web_fetch'].includes(newMsg.toolName) && newMsg.toolOutput && newMsg.toolOutput.length > 2000) {
            // 机制 B：对旧的 ls/grep/web_search/web_fetch 输出，越过阈值（2000）则截断折叠
            const head = newMsg.toolOutput.slice(0, 1000);
            newMsg.toolOutput = `${head}\n\n...[已折叠旧的工具输出结果]...`;
            compactedCount++;
          }
        }
        return newMsg;
      });

      if (compactedCount > 0) {
        // 向消息历史中追加一条 system_alert，以提供可视化的清洗通知
        activeMessages = [
          ...activeMessages,
          {
            role: 'system',
            type: 'system_alert',
            turn: turnIndex,
            content: `触发上下文软清洗 (Soft Compact Epoch)：成功对 ${compactedCount} 处历史冗余数据进行了折叠或重写，从而释放 Context 空间，最大化保护 Prompt Cache。`
          }
        ];
        setMessages(activeMessages); // 永久修改 UI 状态
        // 就地重新估算压缩后的 Token 数（而非粗暴清零），让 Memory Bar 平滑过渡
        const compressedEstimate = Math.round((
          JSON.stringify(buildApiMessages(activeMessages)).length +
          (systemPrompt || '').length +
          JSON.stringify(harness.tools || []).length
        ) / 4);
        setContextTokens(compressedEstimate);
      }
    }

    let apiMessages = buildApiMessages(activeMessages);

    // ── 优化：看板注入 (State Injection) ──
    // 为了最大化 Prompt Cache，我们将看板挂在消息序列的最后
    if (todos && todos.length > 0) {
      const todoSummary = todos.map(t => {
        const marker = { pending: '[ ]', in_progress: '[>]', completed: '[x]', failed: '[!]' }[t.status] || '[ ]';
        return `${marker} ${t.content}`;
      }).join('\n');

      const stateBlock = {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `\n<current_tasks_status>\n${todoSummary}\n</current_tasks_status>\n`
          }
        ]
      };

      // 如果最后一根是用户消息，则合并；否则新增一条
      const lastMsg = apiMessages[apiMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content.push(stateBlock.content[0]);
      } else {
        apiMessages.push(stateBlock);
      }
    }

    // ── 优化：催促机制 (Nag Mechanism) ──
    if (roundsSinceTodo >= 3 && todos && todos.length > 0) {
      const nagBlock = {
        type: 'text',
        text: `\n<system_reminder>\n你已经连续 3 轮没有更新任务看板了。请在采取下一步行动前，务必使用 write_todos 工具同步当前的执行进度。\n</system_reminder>\n`
      };
      const lastMsg = apiMessages[apiMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        lastMsg.content.push(nagBlock);
      } else {
        apiMessages.push({ role: 'user', content: [nagBlock] });
      }
    }

    try {
      const res = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          system: systemPrompt,
          tools: harness.tools,
          model: selectedModel?.modelId || 'claude-3-7-sonnet-20250219',
          apiKey: selectedModel?.key || '',
          baseUrl: selectedModel?.url || 'https://api.anthropic.com',
          temperature,
          maxTokens,
          thinkingEnabled,
        })
      });

      if (!res.ok) {
        // ... (错误处理保持不变)
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
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch { }
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
                  } catch (e) { }
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
          // 阶段一：并行工具执行 (Parallel Tool Execution)
          await Promise.all(toolsToRun.map(executeToolCall));
        } else {
          // 传统的串行执行
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

  const handleSend = async () => {
    const text = inputText.trim();
    if (!text || isRunning) return;
    if (!selectedModel || !selectedModel.key) return alert('请先选择或配置包含 API Key 的模型！');

    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = '44px';
    setIsRunning(true);
    setActiveRightTab('trajectory');

    const nextTurn = loopCount + 1;
    const userMsg = { role: 'user', content: text, turn: nextTurn };
    const currentMessages = [...messages, userMsg];

    setMessages(currentMessages);

    await runAgentLoop(currentMessages, nextTurn);

    setIsRunning(false);
  };

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      {/* ===== 左侧配置面板 ===== */}
      <div className="config-panel" style={{ width: 340, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* API 供应商选择与配置 */}
        <div className="card" style={{ padding: 14 }}>
          <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              API 核心配置
            </div>
            <button
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 11 }}
              onClick={() => setShowAddModel(!showAddModel)}
            >
              + 添加模型
            </button>
          </div>

          {showAddModel && (
            <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px dashed var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>新增模型配置 (保存至 .env)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="显示名称 (如: 本地 DeepSeek)" value={newModelConfig.name} onChange={e => setNewModelConfig({ ...newModelConfig, name: e.target.value })} />
                <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Model ID (如: deepseek-chat)" value={newModelConfig.modelId} onChange={e => setNewModelConfig({ ...newModelConfig, modelId: e.target.value })} />
                <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Base URL (如: https://api.deepseek.com/anthropic)" value={newModelConfig.url} onChange={e => setNewModelConfig({ ...newModelConfig, url: e.target.value })} />
                <input className="input" type="password" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="API Key" value={newModelConfig.key} onChange={e => setNewModelConfig({ ...newModelConfig, key: e.target.value })} />
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button className="btn btn-primary" style={{ flex: 1, padding: '4px' }} onClick={handleAddModel}>保存</button>
                  <button className="btn btn-ghost" style={{ flex: 1, padding: '4px' }} onClick={() => setShowAddModel(false)}>取消</button>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, paddingLeft: 2 }}>选择可用模型</div>
              <div className="model-select-wrapper">
                <select
                  className="model-select"
                  value={selectedModel?.id || ''}
                  onChange={e => {
                    const found = models.find(m => m.id === e.target.value);
                    if (found) setSelectedModel(found);
                  }}
                >
                  {models.length === 0 && <option value="">无可用模型，请添加</option>}
                  {models.map(m => <option key={m.id} value={m.id}>{m.name} ({m.modelId})</option>)}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 模型参数 */}
        <div className="card model-config-card">
          <div className="panel-title">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>
            模型参数
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 10, padding: '4px 0' }}>
            <input type="checkbox" checked={thinkingEnabled} onChange={e => setThinkingEnabled(e.target.checked)} />
            启用思维链 (Extended Thinking / Reasoner)
          </label>

          <div className="param-row" style={{ opacity: thinkingEnabled ? 0.5 : 1 }}>
            <span className="param-label">temp</span>
            <input type="range" className="param-slider" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} disabled={thinkingEnabled} />
            <span className="param-value">{temperature}</span>
          </div>
          <div className="param-row">
            <span className="param-label">max_tok</span>
            <input type="range" className="param-slider" min="1024" max="32000" step="1024" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value))} />
            <span className="param-value" style={{ width: 44 }}>{maxTokens}</span>
          </div>
        </div>

        {/* System Prompt */}
        <div className="card prompt-card" style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column' }}>
          <div className="panel-title">System Prompt</div>
          <textarea
            className="prompt-editor"
            style={{ flex: 1, height: '100%' }}
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
          />
        </div>
      </div>

      {/* ===== 右侧轨迹区 ===== */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, height: '100%' }}>
        {/* 右侧 Tab 栏 */}
        <div style={{
          display: 'flex', gap: 4, padding: '8px 16px', flexShrink: 0,
          background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
          alignItems: 'center',
        }}>
          {[
            { key: 'trajectory', label: '🔄 运行轨迹' },
            { key: 'todos', label: `✅ TODO${todos.length > 0 ? ` (${todos.length})` : ''}` },
          ].map(tab => (
            <button key={tab.key}
              className={`topbar-tab ${activeRightTab === tab.key ? 'active' : ''}`}
              onClick={() => setActiveRightTab(tab.key)}
            >{tab.label}</button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: 120 }} title={`当前 Context 占用: ${currentTokens} tokens`}>
              <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  height: '100%',
                  background: currentTokens > 160000 ? 'var(--red)' : currentTokens > 140000 ? 'var(--orange)' : 'var(--blue)',
                  width: `${Math.min(100, (currentTokens / 200000) * 100)}%`,
                  transition: 'width 0.3s'
                }} />
              </div>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{Math.round(currentTokens / 1000)}k/200k</span>
            </div>
            {(cacheStats.hitTokens + cacheStats.missTokens) > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                title={`缓存命中: ${cacheStats.hitTokens} tokens | 未命中: ${cacheStats.missTokens} tokens`}>
                💾 {Math.round(cacheStats.hitTokens / (cacheStats.hitTokens + cacheStats.missTokens) * 100)}% 命中
              </span>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              已产生 {loopCount} 轮对话
            </span>
            {messages.length > 0 && (
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--purple)' }}
                onClick={() => setShowContextInspector(true)}
                title="查看当前发送给 API 的完整上下文内容"
              >🔍 查看上下文</button>
            )}
            {messages.length > 0 && (
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--red)' }} onClick={() => {
                if (window.confirm('确定要重置当前 Harness 的 Session（清空对话与 TODO 状态）吗？')) {
                  setMessages([]);
                  setTodos([]);
                  setContextTokens(0);
                  if (onSessionReset) onSessionReset();
                }
              }}>🔄 重置 Session</button>
            )}
          </div>
        </div>

        {/* 消息列表内容 */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0 }} ref={scrollContainerRef}>
          {activeRightTab === 'trajectory' && (
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {messages.length === 0 && (
                <div className="empty-state">
                  <div className="empty-state-icon">💬</div>
                  <div className="empty-state-title">Harness 已就绪</div>
                  <div className="empty-state-desc">在左侧选择一个模型，在下方输入消息即可开启真实对话。支持思维链与工具调用。</div>
                </div>
              )}
              {Object.entries(turns).map(([turn, msgs]) => (
                <div key={turn} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="turn-divider"><span className="turn-label">🔄 Loop 第 {turn} 轮</span></div>
                  {msgs.map((msg, idx) => {
                    if (msg.role === 'user') return <UserMessage key={idx} content={msg.content} />;
                    if (msg.type === 'system_alert') return (
                      <div key={idx} className="system-alert-bubble" style={{
                        margin: '8px 0',
                        padding: '10px 14px',
                        background: 'rgba(59, 130, 246, 0.08)',
                        border: '1px dashed var(--blue)',
                        borderRadius: 6,
                        color: 'var(--blue)',
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        boxSizing: 'border-box'
                      }}>
                        <span style={{ fontSize: 16 }}>🌊</span>
                        <div style={{ lineHeight: 1.4 }}>{msg.content}</div>
                      </div>
                    );
                    if (msg.type === 'thinking') return <ThinkingBubble key={idx} content={msg.content} tokens={msg.tokens} duration={msg.duration} />;
                    if (msg.type === 'tool_call') return <ToolCallCard key={idx} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} subMessages={msg.subMessages} />;
                    if (msg.type === 'text') return <AssistantMessage key={idx} content={msg.content} />;
                    return null;
                  })}
                </div>
              ))}
              {isRunning && (
                <div className="running-indicator animate-fade-in" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>
                  <div className="running-dots"><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></div>
                  正在处理中...
                </div>
              )}
              <div ref={chatEndRef} style={{ height: 10 }} />
            </div>
          )}

          {activeRightTab === 'todos' && (
            <div style={{ padding: 20 }}>
              <TodoList todos={todos} />
            </div>
          )}
        </div>

        {/* 消息输入区 */}
        <div className="chat-input-area" style={{ flexShrink: 0 }}>
          <div className="chat-input-row">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder="输入消息，按 Enter 发送，Shift+Enter 换行..."
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isRunning}
            />
            <button className="send-btn" onClick={handleSend} disabled={!inputText.trim() || isRunning}>
              {isRunning ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}
            </button>
          </div>
        </div>
      </div>

      {/* ===== 上下文检查器模态框 ===== */}
      {showContextInspector && (() => {
        const apiMessages = buildApiMessages(messages);
        const fullContext = {
          system: systemPrompt || '(无)',
          tools: (harness.tools || []).map(t => ({ name: t.name, description: t.description?.slice(0, 80) + '...' })),
          messages: apiMessages,
        };
        const totalChars = JSON.stringify(fullContext).length;
        const estimatedTokens = Math.round(totalChars / 4);

        // 角色颜色映射
        const roleStyle = (role) => ({
          user: { bg: 'rgba(59, 130, 246, 0.08)', border: 'var(--blue)', icon: '👤', label: 'User' },
          assistant: { bg: 'rgba(168, 85, 247, 0.08)', border: 'var(--purple)', icon: '🤖', label: 'Assistant' },
        })[role] || { bg: 'rgba(100,100,100,0.08)', border: 'var(--border)', icon: '⚙️', label: role };

        // 渲染单个 content block 的摘要
        const renderBlock = (block, i) => {
          if (block.type === 'text') return <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 4, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>{block.text}</div>;
          if (block.type === 'thinking') return <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'rgba(234, 179, 8, 0.06)', border: '1px dashed var(--orange)', borderRadius: 4, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto' }}><span style={{ fontWeight: 600, color: 'var(--orange)' }}>💭 Thinking</span> ({block.thinking?.length || 0} chars)<br/>{block.thinking?.slice(0, 500)}{block.thinking?.length > 500 ? '...' : ''}</div>;
          if (block.type === 'tool_use') return <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid var(--green)', borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}><span style={{ fontWeight: 600, color: 'var(--green)' }}>🔧 tool_use</span> <code style={{ color: 'var(--blue)' }}>{block.name}</code> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>id={block.id}</span><pre style={{ margin: '4px 0 0', fontSize: 11, maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(block.input, null, 2)}</pre></div>;
          if (block.type === 'tool_result') return <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'rgba(16, 185, 129, 0.04)', border: '1px dashed var(--green)', borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}><span style={{ fontWeight: 600, color: 'var(--green)' }}>📋 tool_result</span> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>id={block.tool_use_id}</span><pre style={{ margin: '4px 0 0', fontSize: 11, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}</pre></div>;
          return <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 4, fontSize: 11 }}><pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(block, null, 2)}</pre></div>;
        };

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowContextInspector(false)}>
            {/* 半透明遮罩 */}
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
            {/* 模态框主体 */}
            <div style={{ position: 'relative', width: '90vw', maxWidth: 900, height: '85vh', background: 'var(--bg-primary)', borderRadius: 12, border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 25px 50px rgba(0,0,0,0.4)' }} onClick={e => e.stopPropagation()}>
              {/* 标题栏 */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 18 }}>🔍</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>上下文检查器 (Context Inspector)</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 4 }}>
                    {apiMessages.length} 条消息 · ~{estimatedTokens.toLocaleString()} tokens · {(totalChars / 1024).toFixed(1)} KB
                  </span>
                </div>
                <button onClick={() => setShowContextInspector(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }} onMouseOver={e => e.target.style.color = 'var(--text-primary)'} onMouseOut={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
              </div>

              {/* 可滚动内容区 */}
              <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
                {/* System Prompt 区块 */}
                <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid var(--orange)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--orange)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>⚙️</span> System Prompt
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({(systemPrompt || '').length} chars)</span>
                  </div>
                  <pre style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', margin: 0, color: 'var(--text-secondary)' }}>{systemPrompt || '(无)'}</pre>
                </div>

                {/* Tools 区块 */}
                <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid var(--green)', borderRadius: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🧰</span> 工具挂载 (Tools Schema)
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({(harness.tools || []).length} 个工具 · {JSON.stringify(harness.tools || []).length} chars)</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(harness.tools || []).map((t, i) => (
                      <span key={i} style={{ fontSize: 12, padding: '3px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 4, fontFamily: 'var(--font-mono)' }}>{t.name}</span>
                    ))}
                  </div>
                </div>

                {/* 分割线 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  Messages 序列 ({apiMessages.length} 条)
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>

                {/* Messages 列表 */}
                {apiMessages.map((msg, msgIdx) => {
                  const rs = roleStyle(msg.role);
                  const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];
                  const charCount = JSON.stringify(msg.content).length;
                  return (
                    <div key={msgIdx} style={{ marginBottom: 12, borderRadius: 8, border: `1px solid ${rs.border}`, overflow: 'hidden' }}>
                      {/* 消息头 */}
                      <div style={{ padding: '8px 14px', background: rs.bg, display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${rs.border}` }}>
                        <span style={{ fontSize: 14 }}>{rs.icon}</span>
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{rs.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>#{msgIdx + 1}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{contentBlocks.length} block(s) · {charCount} chars</span>
                      </div>
                      {/* 消息体 */}
                      <div style={{ padding: '8px 14px' }}>
                        {contentBlocks.map(renderBlock)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 底部状态栏 */}
              <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                <span>💡 这里展示的是经过 buildApiMessages() 处理后，实际发送给大模型 API 的完整上下文内容。</span>
                <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(fullContext, null, 2)); }} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>📋 复制 JSON</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
