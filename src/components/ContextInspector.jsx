import { useState, useEffect } from 'react';
import { parseFeatures } from '../lib/FeatureSchema.js';
import { apiFetch } from '../lib/apiClient.js';

export function ContextInspector({ 
  harness,
  messages, 
  todos = [],
  systemPrompt, 
  tools, 
  skills = [],
  availableSkills = [],
  setShowContextInspector, 
  thinkingEnabled, 
  currentTokens,
  modelConfig
}) {
  const [loading, setLoading] = useState(!!harness?.id);
  const [error, setError] = useState(null);
  const [alignedData, setAlignedData] = useState({ system: '', tools: [], messages: [] });

  // 依赖项序列化计算以精简依赖，防范死循环
  const toolsDeps = (tools || []).map(t => t.name).join(',');
  const skillsDeps = (skills || []).join(',');
  const todosDeps = JSON.stringify(todos);
  const messagesDeps = JSON.stringify(messages); // 用于稳定侦测消息变动
  const availableSkillsDeps = availableSkills.map(s => s.id).join(',');

  useEffect(() => {
    if (!harness?.id) return;

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const { signal } = controller;

    // 前端简化参数：工具只传名称即可，后端会自动匹配 Schema，避免前端做复杂的 schema 组装
    const toolNames = (tools || []).map(t => typeof t === 'string' ? t : t.name);
    const selectedStrategyId = parseFeatures(harness?.features || {}).task_orchestration?.strategy || 'custom';

    apiFetch(`/api/harnesses/${harness.id}/dry-run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages,
        todos,
        systemPrompt,
        tools: toolNames, // 直接发送工具名称序列
        features: harness.features || {},
        selectedStrategyId,
        model: modelConfig,
        temperature: modelConfig?.temperature,
        maxTokens: modelConfig?.max_tokens,
        thinkingEnabled,
        skills // 直接发送启用的 skills id 序列
      }),
      signal
    })
    .then(async res => {
      const isJson = res.headers.get('content-type')?.includes('application/json');
      if (!res.ok) {
        let errorMsg = `HTTP error! status: ${res.status}`;
        if (isJson) {
          try {
            const data = await res.json();
            errorMsg = data.error || errorMsg;
          } catch (_) {}
        } else {
          try {
            const text = await res.text();
            if (text) errorMsg = `${errorMsg} - ${text.slice(0, 100)}`;
          } catch (_) {}
        }
        throw new Error(errorMsg);
      }
      if (!isJson) {
        throw new Error('Backend returned non-JSON response');
      }
      return res.json();
    })
    .then(data => {
      setAlignedData(data);
      setLoading(false);
    })
    .catch(err => {
      if (err.name === 'AbortError') return; // 忽略组件卸载时的主动中止
      console.error('Dry Run Alignment Error:', err);
      setError(err.message || 'Failed to dry run static alignment with backend');
      setLoading(false);
    });

    return () => {
      controller.abort(); // 卸载时主动中止请求，规避 React unmounted state update 泄露警告
    };
  }, [
    harness?.id,
    JSON.stringify(harness?.features || {}),
    messagesDeps,
    todosDeps,
    systemPrompt,
    toolsDeps,
    skillsDeps,
    availableSkillsDeps,
    modelConfig?.modelId || modelConfig?.name,
    modelConfig?.temperature,
    modelConfig?.max_tokens,
    thinkingEnabled
  ]);

  const fullContext = {
    system: alignedData.system || '(None)',
    tools: alignedData.tools || [],
    messages: alignedData.messages || [],
    toolPoolSummary: alignedData.toolPoolSummary || null,
  };
  const totalChars = JSON.stringify(fullContext).length;
  const displayTokens = currentTokens || Math.round(totalChars / 4);
  const parsedFeatures = parseFeatures(harness?.features || {});
  const selectedStrategyId = parsedFeatures.task_orchestration?.strategy || 'custom';
  const systemSummaryText = Array.isArray(alignedData.system)
    ? alignedData.system.map(block => block?.text || '').join('\n')
    : String(alignedData.system || '');
  const messagesSummaryText = (alignedData.messages || [])
    .flatMap(msg => Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: String(msg.content || '') }])
    .map(block => {
      if (typeof block?.text === 'string') return block.text;
      if (typeof block?.content === 'string') return block.content;
      if (typeof block?.thinking === 'string') return block.thinking;
      return '';
    })
    .join('\n');
  const activeStrategyMatch = messagesSummaryText.match(/<active_execution_strategy id="([^"]+)"/);
  const strategySummary = {
    selectedStrategyId,
    hasStrategyIndex: systemSummaryText.includes('<available_execution_strategies>'),
    activeStrategyId: activeStrategyMatch?.[1] || null,
    hasCompatibilityNote: messagesSummaryText.includes('<strategy_compatibility_note>'),
  };

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
        💾 Anthropic Prompt Cache Anchor
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
    const isArray = Array.isArray(alignedData.system);
    const systemText = isArray ? alignedData.system[0]?.text : alignedData.system;
    const hasCache = isArray && alignedData.system[0]?.cache_control;

    return (
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(234, 179, 8, 0.05)', border: '1px solid var(--orange)', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--orange)', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>⚙️</span> Assembled System Prompt
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({String(systemText || '').length} chars)</span>
          </div>
          {hasCache && (
            <span style={{ fontSize: 10, background: 'var(--orange)', color: '#fff', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              💾 Prompt Cache (System)
            </span>
          )}
        </div>
        <pre style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto', margin: 0, color: 'var(--text-secondary)' }}>
          {systemText || '(None)'}
        </pre>
        {isArray && (
          <div style={{ marginTop: 6, fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            Payload Structure: {JSON.stringify(alignedData.system)}
          </div>
        )}
      </div>
    );
  };

  // Render Tools list
  const renderTools = () => {
    return (
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid var(--green)', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🧰</span> Tools Mounting (Tools Schema)
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>({(alignedData.tools || []).length} tools · Sorted alphabetically by name)</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {(alignedData.tools || []).map((t, i) => {
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

  const renderStrategySummary = () => {
    const rows = [
      {
        label: 'Selected',
        value: strategySummary.selectedStrategyId,
        ok: true,
      },
      {
        label: 'Compact Index',
        value: strategySummary.hasStrategyIndex ? 'present in system prompt' : 'not injected',
        ok: strategySummary.hasStrategyIndex,
      },
      {
        label: 'Full Guideline',
        value: strategySummary.activeStrategyId ? `active: ${strategySummary.activeStrategyId}` : 'not injected',
        ok: strategySummary.selectedStrategyId === 'custom' ? !strategySummary.activeStrategyId : !!strategySummary.activeStrategyId,
      },
      {
        label: 'Compatibility',
        value: strategySummary.hasCompatibilityNote ? 'primitive mismatch note injected' : 'no mismatch note',
        ok: !strategySummary.hasCompatibilityNote,
      },
    ];

    return (
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(59, 130, 246, 0.05)', border: '1px solid var(--blue)', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--blue)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🧭</span> Execution Strategy
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
          {rows.map(row => (
            <div key={row.label} style={{ padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{row.label}</div>
              <div style={{ fontSize: 12, color: row.ok ? 'var(--text-secondary)' : 'var(--orange)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>{row.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderToolPoolSummary = () => {
    const summary = alignedData.toolPoolSummary;
    if (!summary) return null;

    const rows = [
      { label: 'Runtime Role', value: summary.runtimeRole || 'lead' },
      { label: 'Strategy', value: summary.strategyId || 'custom' },
      { label: 'Mode', value: summary.orchestration?.mode || 'todo' },
      { label: 'Tools', value: `${summary.count || 0}` },
    ];

    return (
      <div style={{ marginBottom: 16, padding: '12px 16px', background: 'rgba(20, 184, 166, 0.05)', border: '1px solid #14b8a6', borderRadius: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#14b8a6', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🧩</span> Runtime Tool Pool
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 10 }}>
          {rows.map(row => (
            <div key={row.label} style={{ padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>{row.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>{row.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
          <div style={{ padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Runtime Added</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
              {(summary.added || []).join(', ') || 'none'}
            </div>
          </div>
          <div style={{ padding: '8px 10px', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 6 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>Runtime Removed</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
              {(summary.removed || []).join(', ') || 'none'}
            </div>
          </div>
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
            <span style={{ fontWeight: 700, fontSize: 15 }}>Context Inspector</span>
            {!loading && !error && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', background: 'var(--bg-surface)', padding: '2px 8px', borderRadius: 4 }}>
                {alignedData.messages.length} messages · ~{displayTokens.toLocaleString()} tokens · {(totalChars / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
          <button onClick={() => setShowContextInspector(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }} onMouseOver={e => e.target.style.color = 'var(--text-primary)'} onMouseOut={e => e.target.style.color = 'var(--text-muted)'}>✕</button>
        </div>

        {/* 可滚动内容区 */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {loading && (
            <div style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center', 
              padding: '60px 20px', 
              color: 'var(--text-secondary)',
              gap: 12
            }}>
              <span className="animate-spin" style={{ fontSize: 32 }}>⏳</span>
              <div style={{ fontSize: 14, fontWeight: 500 }}>Simulating static context alignment (Dry Run)...</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>This may include skill injection, memory consolidation, and prompt processing.</div>
            </div>
          )}

          {error && (
            <div style={{ 
              padding: '16px 20px', 
              background: 'rgba(239, 68, 68, 0.08)', 
              border: '1px solid #ef4444', 
              borderRadius: 8, 
              color: '#ef4444', 
              fontSize: 13,
              marginBottom: 16
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>❌</span> Static context alignment simulation failed
              </div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {error}
              </pre>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* System Prompt */}
              {renderSystemPrompt()}

              {/* Execution Strategy */}
              {renderStrategySummary()}

              {/* Runtime Tool Pool */}
              {renderToolPoolSummary()}

              {/* Tools */}
              {renderTools()}

              {/* 分割线 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                Messages Sequence ({alignedData.messages.length} messages)
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              {/* Messages 列表 */}
              {alignedData.messages.map((msg, msgIdx) => {
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
            </>
          )}
        </div>

        {/* 底部状态栏 */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>💡 This displays the fully aligned context actually sent to the LLM API after processing by alignRequestPayload().</span>
          <button onClick={() => { navigator.clipboard.writeText(JSON.stringify(fullContext, null, 2)); }} style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}>📋 Copy JSON</button>
        </div>
      </div>
    </div>
  );
}
