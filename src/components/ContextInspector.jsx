import { buildApiMessages } from '../lib/messageBuilder.js';

export function ContextInspector({ messages, systemPrompt, tools, setShowContextInspector, thinkingEnabled, compactionEnabled = true, currentTokens }) {
  const apiMessages = buildApiMessages(messages, thinkingEnabled, compactionEnabled);
  const fullContext = {
    system: systemPrompt || '(无)',
    tools: (tools || []).map(t => ({ name: t.name, description: t.description?.slice(0, 80) + '...' })),
    messages: apiMessages,
  };
  const totalChars = JSON.stringify(fullContext).length;
  // 优先采用精准 API Token 统计或完整的估算值，而非经过极简后的 estimatedTokens
  const displayTokens = currentTokens || Math.round(totalChars / 4);

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
              {apiMessages.length} 条消息 · ~{displayTokens.toLocaleString()} tokens · {(totalChars / 1024).toFixed(1)} KB
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
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({(tools || []).length} 个工具 · {JSON.stringify(tools || []).length} chars)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {(tools || []).map((t, i) => (
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
}
