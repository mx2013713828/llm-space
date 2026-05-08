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
  const buildApiMessages = (sourceMessages) => {
    const apiMsgs = [];
    const flatBlocks = [];
    
    sourceMessages.forEach(msg => {
      if (msg.role === 'user') {
        flatBlocks.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        if (msg.type === 'text') {
          flatBlocks.push({ role: 'assistant', block: { type: 'text', text: msg.content } });
        } else if (msg.type === 'thinking') {
          const block = { type: 'thinking', thinking: msg.content };
          if (msg.signature) block.signature = msg.signature;
          flatBlocks.push({ role: 'assistant', block });
        } else if (msg.type === 'tool_call') {
          const toolCallId = msg.id || `call_${Math.random().toString(36).substring(2, 10)}`;
          msg.id = toolCallId; // 保存生成的 ID 保证前后一致
          flatBlocks.push({ role: 'assistant', block: { type: 'tool_use', id: toolCallId, name: msg.toolName, input: msg.toolInput } });
          
          if (msg.toolOutput) {
            flatBlocks.push({ role: 'user', block: { type: 'tool_result', tool_use_id: toolCallId, content: String(msg.toolOutput) } });
          }
        }
      } else if (msg.role === 'tool') {
        flatBlocks.push({ role: 'user', block: { type: 'tool_result', tool_use_id: msg.toolId, content: String(msg.content) } });
      }
    });

    for (const item of flatBlocks) {
      const lastMsg = apiMsgs[apiMsgs.length - 1];
      if (lastMsg && lastMsg.role === item.role) {
        if (!Array.isArray(lastMsg.content)) {
          lastMsg.content = [{ type: 'text', text: lastMsg.content }];
        }
        if (item.block) {
          lastMsg.content.push(item.block);
        } else {
          lastMsg.content.push({ type: 'text', text: item.content });
        }
      } else {
        if (item.block) {
          apiMsgs.push({ role: item.role, content: [item.block] });
        } else {
          apiMsgs.push({ role: item.role, content: item.content });
        }
      }
    }
    
    return apiMsgs;
  };

  const runAgentLoop = async (currentMessages, turnIndex) => {
    const apiMessages = buildApiMessages(currentMessages);

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

      // 工具更新辅助函数
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
            case 'thinking_start':
              currentMsg = { role: 'assistant', type: 'thinking', turn: turnIndex, content: '', tokens: { input: 0, output: 0 }, signature: evt.signature };
              newMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'thinking_delta':
              currentMsg.content += evt.text;
              updateLatestMsg();
              break;
            case 'text_start':
              currentMsg = { role: 'assistant', type: 'text', turn: turnIndex, content: '' };
              newMessages.push(currentMsg);
              updateLatestMsg();
              break;
            case 'text_delta':
              if (!currentMsg || currentMsg.type !== 'text') {
                currentMsg = { role: 'assistant', type: 'text', turn: turnIndex, content: '' };
                newMessages.push(currentMsg);
              }
              currentMsg.content += evt.text;
              updateLatestMsg();
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
              // 这里仅做状态同步，真实执行放到最后
              updateLatestMsg();
              break;
            case 'stop':
              stopReason = evt.stopReason;
              break;
          }
        }
      }

      // 如果模型停止原因是调用了工具，则继续下一轮循环
      if (stopReason === 'tool_use') {
        const toolsToRun = newMessages.filter(m => m.turn === turnIndex && m.type === 'tool_call');
        
        for (const tool of toolsToRun) {
          // 本地状态更新工具
          if (tool.toolName === 'write_todos' && tool.toolInput?.todos) {
            setTodos(tool.toolInput.todos);
            tool.toolOutput = `[系统] 已成功解析并覆盖写入 ${tool.toolInput.todos.length} 个 TODO 任务。`;
          } else if (tool.toolName === 'web_search' || tool.toolName === 'web_fetch') {
            // 预留的 Mock 工具
            tool.toolOutput = `[模拟执行] ${tool.toolName} 已成功调用。`;
          } else {
            // 真实调用后端代理执行系统命令与文件读写等规范工具
            try {
              const execRes = await fetch('http://localhost:3001/api/execute-tool', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toolName: tool.toolName, toolInput: tool.toolInput })
              });
              const resData = await execRes.json();
              if (!execRes.ok) throw new Error(resData.error || '执行失败');
              tool.toolOutput = String(resData.output);
            } catch (err) {
              tool.toolOutput = `[工具执行错误]\n${err.message}`;
            }
          }
          updateLatestMsg();
        }

        // 短暂延迟避免请求过快
        await new Promise(r => setTimeout(r, 800));
        await runAgentLoop(newMessages, turnIndex);
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
