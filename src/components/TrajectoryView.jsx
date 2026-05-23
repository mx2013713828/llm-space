import { ThinkingBubble, ToolCallCard, UserMessage, AssistantMessage } from './MessageBubbles';
import { TodoList } from './TodoList';

export function TrajectoryView({
  activeRightTab,
  setActiveRightTab,
  messages,
  todos,
  turns,
  isRunning,
  currentTokens,
  cacheStats,
  inputText,
  textareaRef,
  handleInputChange,
  handleKeyDown,
  handleSend,
  chatEndRef,
  scrollContainerRef,
  setShowContextInspector,
  handleResetSession,
  handleRetryTurn,
  loopCount
}) {
  const maxTokens = 200000;
  const tokenPercent = Math.min(100, (currentTokens / maxTokens) * 100);
  let tokenColorClass = "token-info-current-normal";
  let progressFillClass = "progress-fill-glow";

  if (tokenPercent >= 95) {
    tokenColorClass = "token-info-current-danger";
    progressFillClass = "progress-fill-danger";
  } else if (tokenPercent >= 80) {
    tokenColorClass = "token-info-current-warning";
    progressFillClass = "progress-fill-warning";
  }

  return (
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
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--red)' }} onClick={handleResetSession}>🔄 重置 Session</button>
          )}
        </div>
      </div>

      {/* 消息列表内容 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {activeRightTab === 'trajectory' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }} ref={scrollContainerRef}>
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
                    if (msg.role === 'user') return (
                      <UserMessage 
                        key={idx} 
                        content={msg.content} 
                        onRetry={isRunning ? null : () => handleRetryTurn(parseInt(turn, 10), msg.content)} 
                      />
                    );
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
            {/* 底部 Token 页脚 */}
            <div className="token-dashboard">
              <div className="token-info-text">
                Tokens: <span className={tokenColorClass}>{currentTokens.toLocaleString()}</span> / {maxTokens.toLocaleString()}
              </div>
              <div className="progress-bar-wide">
                <div 
                  className={progressFillClass} 
                  style={{ width: `${tokenPercent}%` }}
                />
              </div>
              <div className="token-info-text" style={{ width: '40px', textAlign: 'right' }}>
                {tokenPercent.toFixed(1)}%
              </div>
            </div>
          </div>
        )}

        {activeRightTab === 'todos' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
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
  );
}
