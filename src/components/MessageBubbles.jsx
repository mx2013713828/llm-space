import { useState } from 'react';

/**
 * Thinking 气泡组件
 * 展示 agent 的内部思考过程，支持折叠/展开
 */
export function ThinkingBubble({ content, tokens, duration, isCollapsed: defaultCollapsed = true }) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="message-bubble msg-thinking animate-fade-in">
      <div className="msg-thinking-header" onClick={() => setCollapsed(!collapsed)}>
        <span>🧠</span>
        <span>Thinking</span>
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
          {content}
          {tokens && (
            <div className="thinking-tokens">
              <div className="thinking-token-item">
                <span>📥 输入</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#c4b5fd' }}>{tokens.input}</strong>
              </div>
              <div className="thinking-token-item">
                <span>📤 输出</span>
                <strong style={{ fontFamily: 'var(--font-mono)', color: '#c4b5fd' }}>{tokens.output}</strong>
              </div>
              {duration && (
                <div className="thinking-token-item">
                  <span>⚡ 耗时</span>
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
export function ToolCallCard({ toolName, toolInput, toolOutput, subMessages }) {
  const [expanded, setExpanded] = useState(false);

  const TOOL_ICONS = {
    web_search: '🔍', web_fetch: '🌐', write_todos: '✅',
    weather_report: '🌤️', read_file: '📄', write_file: '✍️',
    execute_command: '⚡',
  };
  const icon = TOOL_ICONS[toolName] || '🔧';

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

  return (
    <div className="message-bubble msg-tool animate-fade-in" style={{ padding: 0 }}>
      <div className="tool-call-header" onClick={() => setExpanded(!expanded)}>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span className="tool-call-name">{toolName}</span>
        <span className="badge badge-cyan" style={{ fontSize: 10 }}>Tool Call</span>
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
              <span>📥</span> 输入参数
            </div>
            <div className="tool-input-code">{formatJson(toolInput)}</div>
          </div>
          {toolOutput && (
            <div>
              <div className="tool-section-label">
                <span>📤</span> 输出结果
              </div>
              <div className="tool-output-code">
                {toolName === 'bash' ? processTerminalOutput(toolOutput) : formatJson(toolOutput)}
              </div>
            </div>
          )}
          {subMessages && subMessages.length > 0 && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg-base)', borderRadius: 8, border: '1px solid var(--border-light)' }}>
              <div className="tool-section-label" style={{ marginBottom: 8, color: 'var(--blue)' }}>
                <span>🤖</span> 子代理执行轨迹 (Sub-agent Trajectory)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {subMessages.map((msg, idx) => {
                  if (msg.role === 'user') return null; // Hide internal user prompts from sub-agent view
                  if (msg.type === 'thinking') return <ThinkingBubble key={idx} content={msg.content} tokens={msg.tokens} duration={msg.duration} />;
                  if (msg.type === 'tool_call') return <ToolCallCard key={idx} toolName={msg.toolName} toolInput={msg.toolInput} toolOutput={msg.toolOutput} subMessages={msg.subMessages} />;
                  if (msg.type === 'text') return <AssistantMessage key={idx} content={msg.content} />;
                  return null;
                })}
              </div>
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
export function UserMessage({ content, onRetry }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div 
      className="message-bubble msg-user animate-fade-in"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative' }}
    >
      <div className="msg-user-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>👤</span>
          <span>User</span>
        </div>
        {onRetry && (
          <button
            onClick={onRetry}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--purple)',
              cursor: 'pointer',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 6px',
              borderRadius: 4,
              opacity: hovered ? 1 : 0.6,
              transition: 'opacity 0.2s',
            }}
            title="撤销本轮及之后对话，并重新填入输入框"
          >
            ⟲ 重试此轮
          </button>
        )}
      </div>
      <div style={{ color: 'var(--text-primary)', lineHeight: 1.65 }}>{content}</div>
    </div>
  );
}

/**
 * 助手文本回复
 */
export function AssistantMessage({ content }) {
  return (
    <div className="message-bubble msg-text animate-fade-in">
      <div className="msg-text-header">
        <span>🤖</span>
        <span>Assistant</span>
        <span className="badge badge-green" style={{ fontSize: 10 }}>Final Answer</span>
      </div>
      <div style={{ color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
        {content}
      </div>
    </div>
  );
}
