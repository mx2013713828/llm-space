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
  const [thinkingEnabled, setThinkingEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt);
  
  // 界面状态
  const [activeRightTab, setActiveRightTab] = useState('trajectory');
  const [messages, setMessages] = useState(savedSession?.messages || harness.trajectory || []);
  const [todos, setTodos] = useState(savedSession?.todos || harness.todos || []);
  const [inputText, setInputText] = useState('');
  const [isRunning, setIsRunning] = useState(false);

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
  /** 组装 API 历史记录 (终极修复版：严格保持顺序 + 智能块聚合) */
  const buildApiMessages = (sourceMessages) => {
    const finalMsgs = [];
    const flatBlocks = [];
    
    // 1. 平铺所有原子块，并标记其应有的角色
    sourceMessages.forEach(msg => {
      if (msg.role === 'user') {
        flatBlocks.push({ role: 'user', block: { type: 'text', text: msg.content } });
      } else if (msg.role === 'assistant') {
        if (msg.type === 'text') {
          flatBlocks.push({ role: 'assistant', block: { type: 'text', text: msg.content } });
        } else if (msg.type === 'thinking') {
          const b = { type: 'thinking', thinking: msg.content };
          if (msg.signature) b.signature = msg.signature;
          flatBlocks.push({ role: 'assistant', block: b });
        } else if (msg.type === 'tool_call') {
          flatBlocks.push({ role: 'assistant', block: { type: 'tool_use', id: msg.id, name: msg.toolName, input: msg.toolInput } });
          if (msg.toolOutput) {
            // 重要：tool_result 标记为 'tool_result' role 暂存，稍后统一聚合
            flatBlocks.push({ role: 'tool_result', block: { type: 'tool_result', tool_use_id: msg.id, content: String(msg.toolOutput) } });
          }
        }
      }
    });

    // 2. 聚合原子块为消息对象
    flatBlocks.forEach(item => {
      let last = finalMsgs[finalMsgs.length - 1];
      const targetRole = item.role === 'tool_result' ? 'user' : item.role;
      
      // 判定逻辑：
      // - 如果角色不同，必须另起一个消息。
      // - 如果角色相同，但当前是 tool_result 且上一个块是 tool_use，则合并（它们属于同一个响应回合）。
      // - 如果从 assistant 块切换到 tool_result，必须另起一个 user 角色消息。
      if (last && last.role === targetRole) {
        last.content.push(item.block);
      } else {
        finalMsgs.push({ role: targetRole, content: [item.block] });
      }
    });

    return finalMsgs;
  };


  // ── 核心 Agent Loop（递归执行） ──
  const runAgentLoop = async (currentMessages, turnIndex, roundsSinceTodo = 0) => {
    let apiMessages = buildApiMessages(currentMessages);

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
        } catch(e) {}
        throw new Error(errorMsg);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentMsg = null;
      let stopReason = null;
      let newMessages = [...currentMessages];
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
              if (evt.inputTokens) window._lastInputTokens = evt.inputTokens;
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
                try { currentMsg.toolInput = JSON.parse(currentMsg.toolInputRaw); } catch {}
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

        await Promise.all(toolsToRun.map(async (tool) => {
          if (tool.toolName === 'write_todos' && tool.toolInput?.todos) {
            setTodos(tool.toolInput.todos);
            hasUpdatedTodoThisTurn = true;
            
            // 优化：返回更详细的 tool_result
            const counts = {
              pending: tool.toolInput.todos.filter(t => t.status === 'pending').length,
              completed: tool.toolInput.todos.filter(t => t.status === 'completed').length,
            };
            tool.toolOutput = `[系统] 已更新看板。当前进度: ${counts.completed}/${tool.toolInput.todos.length} 已完成。`;
          } else if (tool.toolName === 'web_search' || tool.toolName === 'web_fetch') {
            tool.toolOutput = `[模拟执行] ${tool.toolName} 已成功调用（待接入真实 API）。`;
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
                  } catch (e) {}
                }
              }
            } catch (err) {
              tool.toolOutput = `[工具执行错误]\n${err.message}`;
            }
          }
          updateLatestMsg();
        }));

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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
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
                <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="显示名称 (如: 本地 DeepSeek)" value={newModelConfig.name} onChange={e => setNewModelConfig({...newModelConfig, name: e.target.value})} />
                <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Model ID (如: deepseek-chat)" value={newModelConfig.modelId} onChange={e => setNewModelConfig({...newModelConfig, modelId: e.target.value})} />
                <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Base URL (如: https://api.deepseek.com/anthropic)" value={newModelConfig.url} onChange={e => setNewModelConfig({...newModelConfig, url: e.target.value})} />
                <input className="input" type="password" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="API Key" value={newModelConfig.key} onChange={e => setNewModelConfig({...newModelConfig, key: e.target.value})} />
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
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
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              已产生 {loopCount} 轮对话
            </span>
            {messages.length > 0 && (
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--red)' }} onClick={() => {
                if(window.confirm('确定要重置当前 Harness 的 Session（清空对话与 TODO 状态）吗？')) {
                  setMessages([]);
                  setTodos([]);
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
                    if (msg.type === 'thinking') return <ThinkingBubble key={idx} content={msg.content} tokens={msg.tokens} duration={msg.duration} />;
                    if (msg.type === 'tool_call') return <ToolCallCard key={idx} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} />;
                    if (msg.type === 'text') return <AssistantMessage key={idx} content={msg.content} />;
                    return null;
                  })}
                </div>
              ))}
              {isRunning && (
                <div className="running-indicator animate-fade-in" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>
                  <div className="running-dots"><div className="loading-dot"/><div className="loading-dot"/><div className="loading-dot"/></div>
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
              {isRunning ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
