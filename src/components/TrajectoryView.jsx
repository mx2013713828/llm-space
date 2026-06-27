import { useState } from 'react';
import { ThinkingBubble, ToolCallCard, UserMessage, AssistantMessage } from './MessageBubbles';
import { TodoList } from './TodoList';
import { ScheduledTasksPanel } from './ScheduledTasksPanel';
import { formatTokenCount, getModelContextWindow } from '../lib/modelContext.js';
import { getUserMessagePresentation, isAssistantTextFinalAnswer } from '../lib/messagePresentation.js';
import { parseFeatures } from '../lib/FeatureSchema.js';
import { isOrchestrationEnabled } from '../lib/taskOrchestration.js';

export function TrajectoryView({
  activeRightTab,
  setActiveRightTab,
  harness,
  backgroundTasks = [],
  messages,
  todos,
  turns,
  isRunning,
  currentTokens,
  selectedModel,
  cacheStats,
  inputText,
  textareaRef,
  handleInputChange,
  handleKeyDown,
  handleCompositionStart,
  handleCompositionEnd,
  handleSend,
  chatEndRef,
  scrollContainerRef,
  setShowContextInspector,
  handleResetSession,
  handleRetryTurn,
  loopCount,
  pendingPermission,
  handlePermissionDecision
}) {
  const contextWindow = getModelContextWindow(selectedModel);
  const maxTokens = contextWindow.value;
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

  // 缓存命中显示模式：false=百分比，true=详细数值
  const [showCacheDetail, setShowCacheDetail] = useState(false);

  const totalCacheTokens = cacheStats.hitTokens + cacheStats.missTokens + (cacheStats.writeTokens || 0);
  const hitPercent = totalCacheTokens > 0
    ? Math.round(cacheStats.hitTokens / totalCacheTokens * 100)
    : 0;
  const providerLabel = cacheStats.provider || '';
  const orchestration = parseFeatures(harness?.features || {}).task_orchestration;
  const taskBoardLabel = orchestration?.mode === 'task_system' ? 'Task DAG' : 'TODO';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, height: '100%', position: 'relative' }}>
      {/* 右侧 Tab 栏 */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 16px', flexShrink: 0,
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
        alignItems: 'center',
      }}>
        {[
          { key: 'trajectory', label: '🔄 Run Trajectory' },
          { key: 'todos', label: `✅ ${taskBoardLabel}${todos.length > 0 ? ` (${todos.length})` : ''}` },
          isOrchestrationEnabled(orchestration, 'enable_background_tasks') && {
            key: 'background_tasks',
            label: `⚙️ Background Tasks${backgroundTasks && backgroundTasks.length > 0 ? ` (${backgroundTasks.filter(t => t.status === 'running').length}/${backgroundTasks.length})` : ''}`
          },
          isOrchestrationEnabled(orchestration, 'enable_cron_scheduler') && {
            key: 'scheduled',
            label: 'Scheduled'
          }
        ].filter(Boolean).map(tab => (
          <button key={tab.key}
            className={`topbar-tab ${activeRightTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveRightTab(tab.key)}
          >{tab.label}</button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
          {totalCacheTokens > 0 && (
            <span
              onClick={() => setShowCacheDetail(v => !v)}
              title={showCacheDetail ? 'Click to view hit rate' : 'Click to view detailed token count'}
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                cursor: 'pointer',
                userSelect: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 20,
                border: '1px solid rgba(16, 185, 129, 0.35)',
                background: 'rgba(16, 185, 129, 0.07)',
                color: hitPercent >= 60 ? 'var(--green)' : hitPercent >= 30 ? '#f59e0b' : 'var(--red)',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.14)'; e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.6)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(16, 185, 129, 0.07)'; e.currentTarget.style.borderColor = 'rgba(16, 185, 129, 0.35)'; }}
            >
              💾&nbsp;
              {showCacheDetail ? (
                <>
                  <span style={{ color: 'var(--green)' }}>Hit {cacheStats.hitTokens.toLocaleString()}</span>
                  <span style={{ color: 'var(--text-muted)', fontWeight: 300 }}>/</span>
                  <span style={{ color: 'var(--text-muted)' }}>Miss {cacheStats.missTokens.toLocaleString()}</span>
                  {cacheStats.supportsWriteTokens && (
                    <>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 300 }}>/</span>
                      <span style={{ color: 'var(--orange)' }}>Write {(cacheStats.writeTokens || 0).toLocaleString()}</span>
                    </>
                  )}
                </>
              ) : (
                <span>{hitPercent}% Hit{providerLabel ? ` · ${providerLabel}` : ''}</span>
              )}
            </span>
          )}

          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Generated {loopCount} turns
          </span>
          {messages.length > 0 && (
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--purple)' }}
              onClick={() => setShowContextInspector(true)}
              title="View the complete context currently sent to the API"
            >🔍 Context Inspector</button>
          )}
          {messages.length > 0 && (
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--red)' }} onClick={handleResetSession}>🔄 Reset Session</button>
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
                  <div className="empty-state-title">Harness Ready</div>
                  <div className="empty-state-desc">Enter an instruction here to start debugging the Agent...</div>
                </div>
              )}
              {Object.entries(turns).map(([turn, msgs]) => (
                <div key={turn} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div className="turn-divider"><span className="turn-label">🔄 Step {turn}</span></div>
                  {msgs.map((msg, idx) => {
                    const messageKey = msg.id || `${msg.role || 'message'}-${msg.type || 'text'}-${idx}`;
                    // 后台任务完成通知：渲染为紧凑的 inline 状态标签，而非原始 XML 用户气泡
                    if (msg.type === 'bg_notification') {
                      const notifications = [];
                      const regex = /<task_notification>\s*<task_id>([\s\S]*?)<\/task_id>\s*<status>([\s\S]*?)<\/status>\s*<command>([\s\S]*?)<\/command>\s*<summary>([\s\S]*?)<\/summary>\s*<\/task_notification>/g;
                      let match;
                      while ((match = regex.exec(msg.content)) !== null) {
                        notifications.push({ taskId: match[1].trim(), status: match[2].trim(), command: match[3].trim() });
                      }
                      if (notifications.length === 0) return null;
                      return (
                        <div key={messageKey} style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0' }}>
                          {notifications.map((n, nIdx) => {
                            const ok = n.status === 'completed';
                            return (
                              <div key={nIdx} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '3px 10px', fontSize: 11, borderRadius: 12,
                                background: ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                                border: `1px solid ${ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                                color: ok ? '#22c55e' : '#ef4444',
                                maxWidth: '100%', overflow: 'hidden'
                              }}>
                                <span style={{ fontSize: 13, flexShrink: 0 }}>{ok ? '✅' : '❌'}</span>
                                <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, flexShrink: 0 }}>{n.taskId}</span>
                                <span style={{ opacity: 0.5 }}>·</span>
                                <span style={{ opacity: 0.7, wordBreak: 'break-all', display: 'inline-block' }}>
                                  {n.command}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      );
                    }
                    if (msg.role === 'user') {
                      const presentation = getUserMessagePresentation(msg);
                      return (
                        <UserMessage
                          key={messageKey}
                          content={presentation.content}
                          variant={presentation.variant}
                          onRetry={isRunning || presentation.variant === 'scheduled'
                            ? null
                            : () => handleRetryTurn(parseInt(turn, 10), msg.content)}
                        />
                      );
                    }
                    if (msg.type === 'system_alert') return (
                      <div key={messageKey} className="system-alert-bubble" style={{
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
                    if (msg.type === 'thinking') return <ThinkingBubble key={messageKey} content={msg.content} folded={msg.folded} tokens={msg.tokens} duration={msg.duration} />;
                    if (msg.type === 'tool_call') return <ToolCallCard key={messageKey} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} subMessages={msg.subMessages} subAgentStatus={msg.subAgentStatus} subAgentTrace={msg.subAgentTrace} teamStatus={msg.teamStatus} />;
                    if (msg.type === 'text') return (
                      <AssistantMessage
                        key={messageKey}
                        content={msg.content}
                        isFinalAnswer={isAssistantTextFinalAnswer(msgs, idx)}
                      />
                    );
                    return null;
                  })}
                </div>
              ))}
              {isRunning && (
                <div className="running-indicator animate-fade-in" style={{ alignSelf: 'flex-start', margin: '8px 0' }}>
                  <div className="running-dots"><div className="loading-dot" /><div className="loading-dot" /><div className="loading-dot" /></div>
                  Processing...
                </div>
              )}
              <div ref={chatEndRef} style={{ height: 10 }} />
            </div>
            {/* 底部 Context 页脚 */}
            <div className="token-dashboard">
              <div className="token-info-text" style={{ minWidth: 190, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 10 }}>
                  Context Used
                </span>
                <span className={tokenColorClass} style={{ fontFamily: 'var(--font-mono)', fontWeight: 800 }}>
                  {formatTokenCount(currentTokens)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>/</span>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                  {formatTokenCount(maxTokens)}{contextWindow.estimated ? ' est.' : ''}
                </span>
              </div>
              <div className="progress-bar-wide">
                <div 
                  className={progressFillClass} 
                  style={{ width: `${tokenPercent}%` }}
                />
              </div>
              <div className="token-info-text" style={{ width: '52px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
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

        {activeRightTab === 'background_tasks' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <BackgroundTasksPanel backgroundTasks={backgroundTasks} />
          </div>
        )}

        {activeRightTab === 'scheduled' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            <ScheduledTasksPanel key={harness?.id} harnessId={harness?.id} />
          </div>
        )}
      </div>

      {/* 消息输入区 */}
      <div className="chat-input-area" style={{ flexShrink: 0 }}>
        <div className="chat-input-row">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder="Enter message. Press Enter to send, Shift+Enter for a new line..."
            value={inputText}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            rows={1}
            disabled={isRunning}
          />
          <button className="send-btn" onClick={handleSend} disabled={!inputText.trim() || isRunning} title={isRunning ? "Abort" : "Send"}>
            {isRunning ? <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>}
          </button>
        </div>
      </div>

      {/* 安全拦截审批弹窗 */}
      {pendingPermission && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 24,
          boxSizing: 'border-box'
        }}>
          <div className="card animate-fade-in" style={{
            width: '100%',
            maxWidth: 520,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            {/* 警告头部 */}
            <div style={{
              padding: '16px 20px',
              background: 'linear-gradient(90deg, #d97706, #b45309)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 12
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="animate-pulse">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.05em' }}>Security Guard: Sensitive action waiting for authorization</div>
            </div>

            {/* 内容区 */}
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                The Agent is attempting to trigger a sensitive system action. Under the safety guard policy, the current ReAct loop has been suspended. Please review this action to prevent potential hazards:
              </div>

              {/* 规则命中说明 */}
              <div style={{
                padding: '12px 14px',
                background: 'rgba(217, 119, 6, 0.06)',
                border: '1px solid rgba(217, 119, 6, 0.2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 12,
                color: '#d97706',
                lineHeight: 1.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8
              }}>
                <span style={{ fontSize: 14 }}>⚠️</span>
                <div>{pendingPermission.reason}</div>
              </div>

              {/* 代码与命令行高亮 */}
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Tool Call & Arguments</div>
                <div style={{
                  background: 'var(--bg-base)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 14,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  color: 'var(--text-primary)',
                  maxHeight: 180,
                  overflowY: 'auto'
                }}>
                  <div style={{ color: 'var(--blue)', fontWeight: 700, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>🔧</span> {pendingPermission.toolName}
                  </div>
                  <pre style={{
                    margin: 0,
                    padding: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    lineHeight: 1.6,
                    fontSize: 11,
                    color: 'var(--text-secondary)'
                  }}>
                    {JSON.stringify(pendingPermission.toolInput, null, 2)}
                  </pre>
                </div>
              </div>
            </div>

            {/* 动作按钮栏 */}
            <div style={{
              padding: '14px 20px',
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12
            }}>
              <button
                className="btn btn-ghost"
                style={{
                  borderColor: 'var(--red)',
                  color: 'var(--red)',
                  padding: '6px 18px',
                  fontSize: 12,
                  fontWeight: 600
                }}
                onClick={() => handlePermissionDecision(pendingPermission.toolCallId, 'deny')}
              >
                Deny
              </button>
              <button
                className="btn btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #10b981, #059669)',
                  border: 'none',
                  color: '#fff',
                  padding: '6px 22px',
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.2)'
                }}
                onClick={() => handlePermissionDecision(pendingPermission.toolCallId, 'allow')}
              >
                Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BackgroundTasksPanel({ backgroundTasks = [] }) {
  const [expandedTasks, setExpandedTasks] = useState({});

  if (backgroundTasks.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 40 }}>
        <div className="empty-state-icon">⚙️</div>
        <div className="empty-state-title">No Background Tasks</div>
        <div className="empty-state-desc">Background tasks will show up here once a slow command is run.</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
        Active & Historic Processes
      </h3>
      {backgroundTasks.map(task => {
        const isRunning = task.status === 'running';
        const isCompleted = task.status === 'completed';
        const isFailed = task.status === 'failed';
        const isExpanded = !!expandedTasks[task.id];

        let statusColor = 'var(--text-muted)';
        let statusText = task.status.toUpperCase();
        let statusIcon = '⚪';

        if (isRunning) {
          statusColor = 'var(--blue)';
          statusIcon = '⚡';
        } else if (isCompleted) {
          statusColor = 'var(--green)';
          statusIcon = '✅';
        } else if (isFailed) {
          statusColor = 'var(--red)';
          statusIcon = '❌';
        }

        return (
          <div 
            key={task.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--bg-elevated)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              transition: 'border-color 0.15s'
            }}
          >
            {/* 卡片头部 */}
            <div
              onClick={() => setExpandedTasks(prev => ({ ...prev, [task.id]: !prev[task.id] }))}
              style={{
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
                userSelect: 'none',
                gap: 10
              }}
            >
              <span style={{ fontSize: 14 }}>{statusIcon}</span>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-secondary)' }}>
                    {task.id}
                  </span>
                  <span 
                    style={{ 
                      fontSize: 9, 
                      padding: '1px 5px', 
                      borderRadius: 4, 
                      fontWeight: 600,
                      background: isRunning ? 'rgba(59, 130, 246, 0.15)' : isCompleted ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                      color: statusColor
                    }}
                  >
                    {statusText}
                  </span>
                </div>
                <div 
                  style={{ 
                    fontSize: 11, 
                    color: 'var(--text-muted)', 
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginTop: 2
                  }}
                  title={task.command}
                >
                  $ {task.command}
                </div>
              </div>

              {/* 呼吸灯特效 */}
              {isRunning && (
                <span className="pulse-indicator" style={{
                  width: 8, height: 8, borderRadius: '50%', background: 'var(--blue)', marginRight: 4
                }} />
              )}

              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {isExpanded ? 'Collapse ▲' : 'Logs ▶'}
              </span>
            </div>

            {/* 折叠的内容，也就是终端模拟器 */}
            {isExpanded && (
              <div 
                style={{
                  borderTop: '1px solid var(--border)',
                  background: '#0c0f12',
                  padding: 12,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: '#4af626', // 经典黑客绿
                  maxHeight: 300,
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}
              >
                <div>
                  <div style={{ color: '#888', borderBottom: '1px dashed #333', paddingBottom: 4, marginBottom: 8, userSelect: 'none' }}>
                    [Process started at {new Date(task.startedAt).toLocaleTimeString()}]
                    {task.completedAt && ` [Finished at ${new Date(task.completedAt).toLocaleTimeString()}]`}
                  </div>
                  {task.output || 'No outputs recorded yet...'}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
