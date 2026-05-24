import { buildApiMessages, injectTodoState, alignRequestPayload } from '../lib/messageBuilder.js';

export function ContextInspector({ 
  messages, 
  todos = [],
  systemPrompt, 
  tools, 
  skills = [],
  availableSkills = [],
  setShowContextInspector, 
  thinkingEnabled, 
  compactionEnabled = true, 
  currentTokens,
  modelConfig
}) {
  // 1. 构建基础 of API messages
  const apiMessages = buildApiMessages(messages, thinkingEnabled, compactionEnabled);

  // 2. 注入 TODO 状态（前端模拟催促为 0）
  const messagesWithTodos = injectTodoState(apiMessages, todos, 0);

  // 3. 构建 Tools 的 API Schema 表达
  const toolSchemas = (tools || []).map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema || {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(t.parameters || {}).map(([k, v]) => [k, { type: v.type || 'string', description: v.description || '' }])
      ),
      required: Object.entries(t.parameters || {}).filter(([, v]) => v.required).map(([k]) => k),
    }
  }));

  // 4. 将选中的技能 ID 映射为带 assets 的丰富元数据结构
  const richSkills = skills.map(id => {
    const found = availableSkills.find(s => s.id === id);
    if (found) return found;
    // 兜底退回
    return { id, file: `skills/${id}/SKILL.md`, assets: { scripts: [], references: [] } };
  });

  // 调用对齐逻辑生成最终请求 payload
  const aligned = alignRequestPayload(
    systemPrompt || '',
    toolSchemas,
    messagesWithTodos,
    modelConfig,
    richSkills
  );

  const fullContext = {
    system: aligned.system || '(无)',
    tools: aligned.tools || [],
    messages: aligned.messages || [],
  };
  const totalChars = JSON.stringify(fullContext).length;
  const displayTokens = currentTokens || Math.round(totalChars / 4);

  // 角色颜色映射
  const roleStyle = (role) => ({
    user: { bg: 'rgba(59, 130, 246, 0.08)', border: 'var(--blue)', icon: '👤', label: 'User' },
    assistant: { bg: 'rgba(168, 85, 247, 0.08)', border: 'var(--purple)', icon: '🤖', label: 'Assistant' },
  })[role] || { bg: 'rgba(100,100,100,0.08)', border: 'var(--border)', icon: '⚙️', label: role };

  // 渲染单个 content block 的摘要
  const renderBlock = (block, i) => {
    const hasCache = block.cache_control;
    const cacheBadge = hasCache ? (
      <div style={{ 
        display: 'inline-flex', 
        alignItems: 'center', 
        gap: 4, 
        fontSize: 10, 
        background: 'var(--green)', 
        color: '#fff', 
        padding: '2px 8px', 
        borderRadius: 4, 
        fontWeight: 600, 
        marginTop: 6,
        fontFamily: 'sans-serif'
      }}>
        💾 Anthropic Prompt Cache 缓存锚点
      </div>
    ) : null;

    if (block.type === 'text') {
      return (
        <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 4, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto' }}>
          {block.text}
          {cacheBadge && <><br/>{cacheBadge}</>}
        </div>
      );
    }
    if (block.type === 'thinking') {
      return (
        <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'rgba(234, 179, 8, 0.06)', border: '1px dashed var(--orange)', borderRadius: 4, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto' }}>
          <span style={{ fontWeight: 600, color: 'var(--orange)' }}>💭 Thinking</span> ({block.thinking?.length || 0} chars)<br/>
          {block.thinking?.slice(0, 500)}{block.thinking?.length > 500 ? '...' : ''}
          {cacheBadge && <><br/>{cacheBadge}</>}
        </div>
      );
    }
    if (block.type === 'tool_use') {
      return (
        <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'rgba(16, 185, 129, 0.06)', border: '1px solid var(--green)', borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: 'var(--green)' }}>🔧 tool_use</span> <code style={{ color: 'var(--blue)' }}>{block.name}</code> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>id={block.id}</span>
          <pre style={{ margin: '4px 0 0', fontSize: 11, maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(block.input, null, 2)}</pre>
          {cacheBadge && <><br/>{cacheBadge}</>}
        </div>
      );
    }
    if (block.type === 'tool_result') {
      return (
        <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'rgba(16, 185, 129, 0.04)', border: '1px dashed var(--green)', borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}>
          <span style={{ fontWeight: 600, color: 'var(--green)' }}>📋 tool_result</span> <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>id={block.tool_use_id}</span>
          <pre style={{ margin: '4px 0 0', fontSize: 11, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)}</pre>
          {cacheBadge && <><br/>{cacheBadge}</>}
        </div>
      );
    }
    return (
      <div key={i} style={{ margin: '4px 0', padding: '6px 10px', background: 'var(--bg-primary)', borderRadius: 4, fontSize: 11 }}>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(block, null, 2)}</pre>
        {cacheBadge && <><br/>{cacheBadge}</>}
      </div>
    );
  };

  // 渲染 System Prompt
  const renderSystemPrompt = () => {
    const isArray = Array.isArray(aligned.system);
    const systemText = isArray ? aligned.system[0]?.text : aligned.system;
    const hasCache = isArray && aligned.system[0]?.cache_control;

    return (
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid var(--orange)', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--orange)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⚙️</span> System Prompt
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({String(systemText || '').length} chars)</span>
          </div>
          {hasCache && (
            <span style={{ fontSize: 10, background: 'var(--orange)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              💾 Prompt Cache (System)
            </span>
          )}
        </div>
        <pre style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflow: 'auto', margin: 0, color: 'var(--text-secondary)' }}>
          {systemText || '(无)'}
        </pre>
        {isArray && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            发送结构: {JSON.stringify(aligned.system)}
          </div>
        )}
      </div>
    );
  };

  // 渲染 Tools 列表
  const renderTools = () => {
    return (
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid var(--green)', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🧰</span> 工具挂载 (Tools Schema)
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({(aligned.tools || []).length} 个工具 · 按名称字母序排序)</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(aligned.tools || []).map((t, i) => {
            const hasCache = t.cache_control;
            return (
              <span 
                key={i} 
                style={{ 
                  fontSize: 12, 
                  padding: '3px 10px', 
                  background: 'var(--bg-primary)', 
                  border: hasCache ? '1px solid var(--green)' : '1px solid var(--border)', 
                  borderRadius: 4, 
                  fontFamily: 'var(--font-mono)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {t.name}
                {hasCache && (
                  <span style={{ fontSize: 9, color: 'var(--green)', fontWeight: 'bold', background: 'rgba(16, 185, 129, 0.1)', padding: '1px 4px', borderRadius: 2 }}>
                    💾 [Cache]
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
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
              {aligned.messages.length} 条消息 · ~{displayTokens.toLocaleString()} tokens · {(totalChars / 1024).toFixed(1)} KB
            </span>
          </div>
          <button onClick={() => setShowContextInspector(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }} onMouseOver={e => e.target.style.color = 'var(--text-primary)'} onMouseOut={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
        </div>

        {/* 可滚动内容区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {/* System Prompt */}
          {renderSystemPrompt()}

          {/* Tools */}
          {renderTools()}

          {/* 分割线 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            Messages 序列 ({aligned.messages.length} 条)
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          </div>

          {/* Messages 列表 */}
          {aligned.messages.map((msg, msgIdx) => {
            const rs = roleStyle(msg.role);
            const contentBlocks = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content) }];
            const charCount = JSON.stringify(msg.content).length;
            const hasCache = contentBlocks.some(b => b.cache_control);

            return (
              <div key={msgIdx} style={{ 
                marginBottom: 12, 
                borderRadius: 8, 
                border: hasCache ? '1px solid var(--green)' : `1px solid ${rs.border}`, 
                overflow: 'hidden',
                boxShadow: hasCache ? '0 0 8px rgba(16, 185, 129, 0.1)' : 'none'
              }}>
                {/* 消息头 */}
                <div style={{ 
                  padding: '8px 14px', 
                  background: hasCache ? 'rgba(16, 185, 129, 0.08)' : rs.bg, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 8, 
                  borderBottom: hasCache ? '1px solid var(--green)' : `1px solid ${rs.border}` 
                }}>
                  <span style={{ fontSize: 14 }}>{rs.icon}</span>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{rs.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>#{msgIdx + 1}</span>
                  {hasCache && (
                    <span style={{ fontSize: 10, background: 'var(--green)', color: '#fff', padding: '1px 6px', borderRadius: 4, fontWeight: 600, fontFamily: 'sans-serif' }}>
                      💾 [Cache Point]
                    </span>
                  )}
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
          <span>💡 这里展示的是经过 alignRequestPayload() 处理后，实际发送给大模型 API 的完整对齐上下文。</span>
          <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(fullContext, null, 2)); }} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>📋 复制 JSON</button>
        </div>
      </div>
    </div>
  );
}

