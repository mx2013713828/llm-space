import { memo, useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer.jsx';
import { getThinkingDisplayContent } from '../lib/messagePresentation.js';
import { getSpawnCardTeammate } from '../lib/teamStatusPresentation.js';
import {
  getBadgeClassForTone,
  getTeammateStatusPresentation,
  getToolStatusPresentation,
} from '../lib/runtimeStatusPresentation.js';

/**
 * Thinking 气泡组件
 * 展示 agent 的内部思考过程，支持折叠/展开
 */
export function ThinkingBubble({ content, tokens, duration, folded = false, isCollapsed: defaultCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="message-bubble msg-thinking animate-fade-in">
      <div className="msg-thinking-header" onClick={() => setCollapsed(!collapsed)}>
        <span>🧠</span>
        <span>Thinking Trajectory</span>
        {tokens && (
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9f7aea', fontFamily: 'var(--font-mono)' }}>
            {tokens.input}↑ {tokens.output}↓
          </span>
        )}
        {duration && (
          <span style={{ fontSize: 11, color: '#9f7aea' }}>
            ⏱ {duration}s
          </span>
        )}
        <svg
          className={`chevron ${collapsed ? '' : 'open'}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {!collapsed && (
        <div className="thinking-content animate-fade-in">
          {getThinkingDisplayContent(content, folded)}
          {tokens && (
            <div className="thinking-tokens">
              <div className="thinking-token-item">
                <span>📥 Input</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#c4b5fd' }}>{tokens.input}</strong>
              </div>
              <div className="thinking-token-item">
                <span>📤 Output</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#c4b5fd' }}>{tokens.output}</strong>
              </div>
              {duration && (
                <div className="thinking-token-item">
                  <span>⚡ Duration</span>
                  <strong style={{ fontFamily: 'var(--font-mono)', color: '#c4b5fd' }}>{duration}s</strong>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 工具调用卡片
 * 展示工具名称、输入参数、输出结果，支持折叠
 */
export function ToolCallCard({ toolName, toolInput, toolOutput, toolStatus, subMessages, subAgentStatus, subAgentTrace, teamStatus }) {
  const [expanded, setExpanded] = useState(false);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');
  const [loadedTrace, setLoadedTrace] = useState(null);
  const [traceVisibleCount, setTraceVisibleCount] = useState(20);

  const TOOL_ICONS = {
    web_search: '🔍', web_fetch: '🌐', write_todos: '✅',
    weather_report: '🌤️', read_file: '📄', write_file: '✍️',
    execute_command: '⚡',
  };
  const icon = TOOL_ICONS[toolName] || '🔧';
  const isSubAgent = toolName === 'sub_agent';
  const isSpawnTeammate = toolName === 'spawn_teammate';
  const cardTeammate = isSpawnTeammate ? getSpawnCardTeammate(teamStatus, toolInput) : null;
  const toolPresentation = getToolStatusPresentation({ toolStatus, toolOutput });

  const formatJson = (obj) => {
    try {
      return typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    } catch { return String(obj); }
  };

  /** 处理终端输出中的回车符 (\r)，实现进度条原地更新 */
  const processTerminalOutput = (text) => {
    if (typeof text !== 'string') return text;
    // 按行分割
    const lines = text.split('\n');
    const processedLines = lines.map(line => {
      // 找到最后一个 \r 的位置
      const lastCR = line.lastIndexOf('\r');
      if (lastCR === -1) return line;
      // 只保留最后一个 \r 之后的内容（模拟原地覆盖）
      return line.substring(lastCR + 1);
    });
    return processedLines.join('\n');
  };

  const loadSubAgentTrace = async () => {
    if (!subAgentTrace?.traceId || !subAgentTrace?.path || loadedTrace || traceLoading) return;

    const match = subAgentTrace.path.match(/^server\/sessions\/([^/]+)_subagents\/([^/]+)\.json$/);
    if (!match) {
      setTraceError('Trace reference is not readable.');
      return;
    }

    setTraceLoading(true);
    setTraceError('');
    try {
      const res = await fetch(`http://localhost:3001/api/sub-agent-traces/${match[1]}/${match[2]}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setLoadedTrace(await res.json());
      setTraceVisibleCount(20);
    } catch (err) {
      setTraceError(err.message || 'Failed to load trace');
    } finally {
      setTraceLoading(false);
    }
  };

  const loadTeammateTrace = async () => {
    const traceRef = cardTeammate?.traceRef;
    if (!traceRef?.path || loadedTrace || traceLoading) return;

    const match = traceRef.path.match(/^server\/sessions\/([^/]+)_teammates\/([^/]+)\/([^/]+)\.json$/);
    if (!match) {
      setTraceError('Trace reference is not readable.');
      return;
    }

    setTraceLoading(true);
    setTraceError('');
    try {
      const res = await fetch(`http://localhost:3001/api/team-traces/${match[1]}/${match[2]}/${match[3]}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setLoadedTrace(await res.json());
      setTraceVisibleCount(20);
    } catch (err) {
      setTraceError(err.message || 'Failed to load trace');
    } finally {
      setTraceLoading(false);
    }
  };

  const renderSubAgentStatus = () => {
    if (!isSubAgent || !subAgentStatus) return null;
    const status = subAgentStatus.status || 'running';
    const isDone = status === 'completed';
    const color = isDone ? 'var(--green)' : status === 'failed' ? 'var(--red)' : 'var(--blue)';
    const elapsedSeconds = subAgentStatus.startedAt
      ? Math.max(0, Math.round(((subAgentStatus.completedAt ? new Date(subAgentStatus.completedAt) : new Date()) - new Date(subAgentStatus.startedAt)) / 1000))
      : null;

    return (
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        marginLeft: 'auto',
        minWidth: 0,
        color,
        fontSize: 11,
      }}>
        <span className="badge" style={{ color, border: `1px solid ${color}`, background: 'transparent', fontSize: 10 }}>
          {status}
        </span>
        {subAgentStatus.currentAction && (
          <span style={{ color: 'var(--text-muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {subAgentStatus.currentAction}
          </span>
        )}
        {Number.isFinite(subAgentStatus.toolCount) && (
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {subAgentStatus.toolCount} tools
          </span>
        )}
        {elapsedSeconds !== null && (
          <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {elapsedSeconds}s
          </span>
        )}
      </div>
    );
  };

  const renderTeamStatus = () => {
    if (!isSpawnTeammate || !cardTeammate) return null;

    const state = cardTeammate.state || 'unknown';
    const presentation = getTeammateStatusPresentation(cardTeammate);
    const color = presentation.tone === 'success'
      ? 'var(--green)'
      : presentation.tone === 'danger'
        ? 'var(--red)'
        : 'var(--blue)';
    const briefSummary = cardTeammate.brief?.objective || cardTeammate.prompt || '';
    const trimmedBrief = briefSummary.length > 64 ? `${briefSummary.slice(0, 61)}...` : briefSummary;
    const label = `${cardTeammate.name || cardTeammate.agentId}: ${state}${trimmedBrief ? ` · ${trimmedBrief}` : ''}`;

    return (
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        marginLeft: 'auto',
        minWidth: 0,
        color,
        fontSize: 11,
      }}>
        <span className="badge" style={{ color, border: `1px solid ${color}`, background: 'transparent', fontSize: 10 }}>
          {presentation.label}
        </span>
        <span style={{ color: 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </div>
    );
  };

  return (
    <div className="message-bubble msg-tool animate-fade-in" style={{ padding: 0 }}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span className="tool-call-name">{toolName}</span>
        <span className="badge badge-cyan" style={{ fontSize: 10 }}>Tool Call</span>
        {toolPresentation && (
          <span className={`badge ${getBadgeClassForTone(toolPresentation.tone)}`} style={{ fontSize: 10 }}>
            {toolPresentation.label}
          </span>
        )}
        {renderSubAgentStatus()}
        {renderTeamStatus()}
        <svg
          className={`chevron ${expanded ? 'open' : ''}`}
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>

      {expanded && (
        <div className="tool-call-body animate-fade-in">
          <div>
            <div className="tool-section-label">
              <span>📥</span> Tool Input
            </div>
            <div className="tool-input-code">{formatJson(toolInput)}</div>
          </div>
          {toolOutput && (
            <div>
              <div className="tool-section-label">
                <span>📤</span> Tool Output
              </div>
              <div className="tool-output-code">
                {toolName === 'bash' ? processTerminalOutput(toolOutput) : formatJson(toolOutput)}
              </div>
            </div>
          )}
          {subMessages && subMessages.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
              <div className="tool-section-label" style={{ marginBottom: 8, color: 'var(--blue)' }}>
                <span>🤖</span> Sub-agent Trajectory
                <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
                  preview, bounded for UI responsiveness
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {subMessages.map((msg, idx) => {
                  const messageKey = msg.id || `${msg.role || 'message'}-${msg.type || 'text'}-${idx}`;
                  if (msg.role === 'user') return null; // Hide internal user prompts from sub-agent view
                  if (msg.type === 'thinking') return <ThinkingBubble key={messageKey} content={msg.content} tokens={msg.tokens} duration={msg.duration} />;
                  if (msg.type === 'tool_call') return <ToolCallCard key={messageKey} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} toolStatus={msg.toolStatus} subMessages={msg.subMessages} subAgentStatus={msg.subAgentStatus} subAgentTrace={msg.subAgentTrace} teamStatus={msg.teamStatus} />;
                  if (msg.type === 'text') return <AssistantMessage key={messageKey} content={msg.content} streaming={msg.streaming} />;
                  return null;
                })}
              </div>
            </div>
          )}
          {isSubAgent && subAgentTrace && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
              <div className="tool-section-label" style={{ marginBottom: 8, color: 'var(--blue)' }}>
                <span>🗂️</span> Full Sub-agent Trace
                {subAgentTrace.summary && (
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
                    {subAgentTrace.summary.messageCount} messages · {subAgentTrace.summary.toolCallCount} tools
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const nextExpanded = !traceExpanded;
                  setTraceExpanded(nextExpanded);
                  if (nextExpanded) await loadSubAgentTrace();
                }}
                style={{ padding: '4px 10px', fontSize: 11, height: 26, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                {traceExpanded ? 'Hide full trace' : 'Load full trace'}
              </button>
              {traceLoading && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>Loading trace...</div>
              )}
              {traceError && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)' }}>{traceError}</div>
              )}
              {traceExpanded && loadedTrace && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflow: 'auto' }}>
                  {(loadedTrace.messages || []).slice(0, traceVisibleCount).map((msg, idx) => {
                    const messageKey = msg.id || `${msg.role || 'message'}-${msg.type || 'text'}-${idx}`;
                    if (msg.role === 'user') return null;
                    if (msg.type === 'thinking') return <ThinkingBubble key={messageKey} content={msg.content} tokens={msg.tokens} duration={msg.duration} />;
                    if (msg.type === 'tool_call') return <ToolCallCard key={messageKey} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} toolStatus={msg.toolStatus} subMessages={msg.subMessages} subAgentStatus={msg.subAgentStatus} subAgentTrace={msg.subAgentTrace} teamStatus={msg.teamStatus} />;
                    if (msg.type === 'text') return <AssistantMessage key={messageKey} content={msg.content} streaming={msg.streaming} />;
                    return null;
                  })}
                  {(loadedTrace.messages || []).length > traceVisibleCount && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setTraceVisibleCount(count => count + 20)}
                      style={{ alignSelf: 'center', padding: '4px 10px', fontSize: 11, height: 26, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Load more trace messages ({traceVisibleCount}/{loadedTrace.messages.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {isSpawnTeammate && cardTeammate?.traceRef && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
              <div className="tool-section-label" style={{ marginBottom: 8, color: 'var(--blue)' }}>
                <span>🗂️</span> Teammate Trace
                {cardTeammate.traceRef.summary && (
                  <span style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 10, fontWeight: 400 }}>
                    {cardTeammate.traceRef.summary.messageCount} messages · {cardTeammate.traceRef.summary.toolCallCount} tools
                  </span>
                )}
              </div>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  const nextExpanded = !traceExpanded;
                  setTraceExpanded(nextExpanded);
                  if (nextExpanded) await loadTeammateTrace();
                }}
                style={{ padding: '4px 10px', fontSize: 11, height: 26, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
              >
                {traceExpanded ? 'Hide teammate trace' : 'Load teammate trace'}
              </button>
              {traceLoading && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>Loading trace...</div>
              )}
              {traceError && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--red)' }}>{traceError}</div>
              )}
              {traceExpanded && loadedTrace && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 520, overflow: 'auto' }}>
                  {(loadedTrace.messages || []).slice(0, traceVisibleCount).map((msg, idx) => {
                    const messageKey = msg.id || `${msg.role || 'message'}-${msg.type || 'text'}-${idx}`;
                    if (msg.role === 'user') return null;
                    if (msg.type === 'thinking') return <ThinkingBubble key={messageKey} content={msg.content} tokens={msg.tokens} duration={msg.duration} />;
                    if (msg.type === 'tool_call') return <ToolCallCard key={messageKey} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} toolStatus={msg.toolStatus} subMessages={msg.subMessages} subAgentStatus={msg.subAgentStatus} subAgentTrace={msg.subAgentTrace} teamStatus={msg.teamStatus} />;
                    if (msg.type === 'text') return <AssistantMessage key={messageKey} content={msg.content} streaming={msg.streaming} />;
                    return null;
                  })}
                  {(loadedTrace.messages || []).length > traceVisibleCount && (
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setTraceVisibleCount(count => count + 20)}
                      style={{ alignSelf: 'center', padding: '4px 10px', fontSize: 11, height: 26, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                    >
                      Load more trace messages ({traceVisibleCount}/{loadedTrace.messages.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 用户消息气泡
 */
export function UserMessage({ content, onRetry, variant = 'user' }) {
  const isScheduled = variant === 'scheduled';
  return (
    <div className="msg-user-container">
      {onRetry && (
        <button 
          className="btn-rewind" 
          onClick={onRetry} 
          title="Rewind to before this turn to restart"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          REWIND
        </button>
      )}
      <div className={`message-bubble msg-user ${isScheduled ? 'msg-scheduled' : ''} animate-fade-in`}>
        <div className="msg-user-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>{isScheduled ? '⏰' : '👤'}</span>
            <span>{isScheduled ? 'Scheduler' : 'User'}</span>
            {isScheduled && <span className="badge badge-cyan" style={{ fontSize: 10 }}>Scheduled</span>}
          </div>
        </div>
        <div style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>{content}</div>
      </div>
    </div>
  );
}

/**
 * 助手文本回复
 */
export const AssistantMessage = memo(function AssistantMessage({ content, isFinalAnswer = true, streaming = false }) {
  return (
    <div className="message-bubble msg-text animate-fade-in">
      <div className="msg-text-header">
        <span>🤖</span>
        <span>Assistant</span>
        <span className={`badge ${isFinalAnswer ? 'badge-green' : 'badge-cyan'}`} style={{ fontSize: 10 }}>
          {isFinalAnswer ? 'Final Answer' : 'Progress'}
        </span>
      </div>
      {streaming ? (
        <div className="markdown-content">
          <p style={{ whiteSpace: 'pre-wrap' }}>{content}</p>
        </div>
      ) : (
        <MarkdownRenderer content={content} />
      )}
    </div>
  );
});
