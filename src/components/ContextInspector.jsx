import { useEffect, useMemo, useRef, useState } from 'react';
import { parseFeatures } from '../lib/FeatureSchema.js';
import { apiFetch } from '../lib/apiClient.js';
import { buildContextInspectorModel, getActiveTranscriptItemId } from '../lib/contextInspectorModel.js';

function getToolName(tool) {
  return typeof tool === 'string' ? tool : tool?.name;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
}

function getRoleTone(role) {
  if (role === 'user') {
    return { color: '#2563eb', background: 'rgba(37, 99, 235, 0.10)', border: 'rgba(37, 99, 235, 0.22)' };
  }
  if (role === 'assistant') {
    return { color: '#059669', background: 'rgba(5, 150, 105, 0.10)', border: 'rgba(5, 150, 105, 0.22)' };
  }
  if (role === 'tool') {
    return { color: '#d97706', background: 'rgba(217, 119, 6, 0.10)', border: 'rgba(217, 119, 6, 0.22)' };
  }
  return { color: 'var(--text-secondary)', background: 'var(--bg-surface)', border: 'var(--border)' };
}

function getBlockTone(displayKind) {
  if (displayKind === 'thinking') {
    return {
      label: 'THINKING',
      color: '#b45309',
      background: 'rgba(245, 158, 11, 0.10)',
      header: 'rgba(245, 158, 11, 0.14)',
      border: 'rgba(245, 158, 11, 0.36)',
      rail: '#f59e0b',
    };
  }
  if (displayKind === 'tool') {
    return {
      label: 'TOOL',
      color: '#4f46e5',
      background: 'rgba(99, 102, 241, 0.09)',
      header: 'rgba(99, 102, 241, 0.13)',
      border: 'rgba(99, 102, 241, 0.34)',
      rail: '#6366f1',
    };
  }
  if (displayKind === 'data') {
    return {
      label: 'DATA',
      color: '#64748b',
      background: 'rgba(100, 116, 139, 0.08)',
      header: 'rgba(100, 116, 139, 0.12)',
      border: 'rgba(100, 116, 139, 0.24)',
      rail: '#94a3b8',
    };
  }
  return {
    label: 'TEXT',
    color: 'var(--text-muted)',
    background: 'var(--bg-base)',
    header: 'var(--bg-surface)',
    border: 'var(--border)',
    rail: 'transparent',
  };
}

export function ContextInspector({
  harness,
  messages,
  todos = [],
  systemPrompt,
  tools,
  skills = [],
  setShowContextInspector,
  thinkingEnabled,
  currentTokens,
  modelConfig,
}) {
  const [loading, setLoading] = useState(!!harness?.id);
  const [error, setError] = useState(null);
  const [alignedData, setAlignedData] = useState({ system: '', tools: [], messages: [], promptAssembly: { sections: [] } });
  const [selectedSectionId, setSelectedSectionId] = useState('');
  const transcriptScrollRef = useRef(null);
  const messageNodeRefs = useRef(new Map());
  const indexNodeRefs = useRef(new Map());
  const pendingMessageScrollRef = useRef('');
  const scrollFrameRef = useRef(null);

  const toolsDeps = (tools || []).map(getToolName).join(',');
  const skillsDeps = (skills || []).join(',');
  const todosDeps = JSON.stringify(todos);
  const messagesDeps = JSON.stringify(messages);

  useEffect(() => {
    if (!harness?.id) return;

    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      const toolNames = (tools || []).map(getToolName).filter(Boolean);
      const selectedStrategyId = parseFeatures(harness?.features || {}).task_orchestration?.strategy || 'custom';

      apiFetch(`/api/harnesses/${harness.id}/dry-run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dryRunMode: 'static_context',
          messages,
          todos,
          systemPrompt,
          tools: toolNames,
          features: harness.features || {},
          selectedStrategyId,
          model: modelConfig,
          temperature: modelConfig?.temperature,
          maxTokens: modelConfig?.max_tokens,
          thinkingEnabled,
          skills,
        }),
        signal: controller.signal,
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
          const nextModel = buildContextInspectorModel(data);
          setSelectedSectionId(prev => {
            const stillExists = nextModel.groups.some(group => group.rows.some(row => row.id === prev));
            return stillExists ? prev : nextModel.defaultSelectionId;
          });
          setLoading(false);
        })
        .catch(err => {
          if (err.name === 'AbortError') return;
          console.error('Dry Run Alignment Error:', err);
          setError(err.message || 'Failed to dry run static context alignment with backend');
          setLoading(false);
        });
    }, 250);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    harness?.id,
    JSON.stringify(harness?.features || {}),
    messagesDeps,
    todosDeps,
    systemPrompt,
    toolsDeps,
    skillsDeps,
    modelConfig?.modelId || modelConfig?.name,
    modelConfig?.temperature,
    modelConfig?.max_tokens,
    thinkingEnabled,
  ]);

  const inspectorModel = useMemo(() => buildContextInspectorModel(alignedData), [alignedData]);
  const rows = inspectorModel.groups.flatMap(group => group.rows);
  const selectedRow = rows.find(row => row.id === selectedSectionId) || rows[0] || null;
  const selectedIsMessages = selectedSectionId === 'messages_transcript' || selectedRow?.kind === 'message';
  const selectedMessageId = selectedRow?.kind === 'message' ? selectedRow.id : '';
  const fullContext = {
    system: alignedData.system || '(None)',
    tools: alignedData.tools || [],
    messages: alignedData.messages || [],
  };
  const totalChars = JSON.stringify(fullContext).length;
  const displayTokens = currentTokens || Math.round(totalChars / 4);

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current) cancelAnimationFrame(scrollFrameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!selectedMessageId) return;

    const indexNode = indexNodeRefs.current.get(selectedMessageId);
    indexNode?.scrollIntoView({ block: 'nearest' });
  }, [selectedMessageId]);

  useEffect(() => {
    if (!selectedIsMessages) return;
    const targetId = pendingMessageScrollRef.current;
    if (!targetId) return;

    pendingMessageScrollRef.current = '';
    const messageNode = messageNodeRefs.current.get(targetId);
    messageNode?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [selectedIsMessages, selectedMessageId]);

  function setMessageNode(id, node) {
    if (node) {
      messageNodeRefs.current.set(id, node);
    } else {
      messageNodeRefs.current.delete(id);
    }
  }

  function setIndexNode(id, node) {
    if (node) {
      indexNodeRefs.current.set(id, node);
    } else {
      indexNodeRefs.current.delete(id);
    }
  }

  function selectInspectorRow(row) {
    if (row.kind === 'message') {
      pendingMessageScrollRef.current = row.id;
    }
    setSelectedSectionId(row.id);
  }

  function syncSelectedMessageFromScroll() {
    const container = transcriptScrollRef.current;
    if (!container || !selectedIsMessages) return;

    const positions = inspectorModel.messageTranscript.items
      .map(item => {
        const node = messageNodeRefs.current.get(item.id);
        if (!node) return null;
        return {
          id: item.id,
          top: node.offsetTop,
          bottom: node.offsetTop + node.offsetHeight,
        };
      })
      .filter(Boolean);
    const activeId = getActiveTranscriptItemId(positions, container.scrollTop, 86);

    if (activeId && activeId !== selectedMessageId) {
      setSelectedSectionId(activeId);
    }
  }

  function handleTranscriptScroll() {
    if (scrollFrameRef.current) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncSelectedMessageFromScroll();
    });
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={() => setShowContextInspector(false)}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)' }} />

      <div
        style={{
          position: 'relative',
          width: '92vw',
          maxWidth: 1120,
          height: '86vh',
          background: 'var(--bg-surface)',
          borderRadius: 10,
          border: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.42)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-primary)' }}>Context Inspector</span>
            {!loading && !error && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {alignedData.messages?.length || 0} messages · {alignedData.tools?.length || 0} tools · ~{displayTokens.toLocaleString()} tokens · {(totalChars / 1024).toFixed(1)} KB
              </span>
            )}
          </div>
          <button
            onClick={() => setShowContextInspector(false)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
            onMouseOver={e => { e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseOut={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            x
          </button>
        </div>

        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-secondary)' }}>
            <span className="animate-spin" style={{ fontSize: 30 }}>⏳</span>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Building static context preview...</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No model calls are made for this inspector view.</div>
          </div>
        )}

        {error && (
          <div style={{ flex: 1, padding: 20 }}>
            <div style={{ padding: '14px 16px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Static context preview failed</div>
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{error}</pre>
            </div>
          </div>
        )}

        {!loading && !error && (
          <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '300px 1fr' }}>
            <aside style={{ borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12, background: 'var(--bg-surface)' }}>
              {inspectorModel.groups.map(group => (
                <div key={group.id} style={{ marginBottom: 16 }}>
                  {group.id === 'messages' ? (
                    <button
                      onClick={() => setSelectedSectionId('messages_transcript')}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        color: selectedIsMessages ? 'var(--blue)' : 'var(--text-muted)',
                        textTransform: 'uppercase',
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: 0,
                        marginBottom: 7,
                        cursor: 'pointer',
                      }}
                    >
                      {group.label} · {group.rows.length}
                    </button>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 800, letterSpacing: 0, marginBottom: 7 }}>
                      {group.label} · {group.rows.length}
                    </div>
                  )}
                  {group.rows.map(row => {
                    const active = selectedRow?.id === row.id && selectedSectionId !== 'messages_transcript';
                    return (
                      <button
                        key={row.id}
                        ref={node => {
                          if (row.kind === 'message') setIndexNode(row.id, node);
                        }}
                        onClick={() => selectInspectorRow(row)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'block',
                          padding: '9px 10px',
                          marginBottom: 6,
                          borderRadius: 6,
                          border: active ? '1px solid var(--blue)' : '1px solid var(--border)',
                          background: active ? 'rgba(59, 130, 246, 0.10)' : 'var(--bg-surface)',
                          color: 'var(--text-primary)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 750, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.subtitle}</div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </aside>

            <section
              ref={transcriptScrollRef}
              onScroll={handleTranscriptScroll}
              style={{ minWidth: 0, overflow: 'auto', padding: 16 }}
            >
              {selectedIsMessages ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 850, color: 'var(--text-primary)', marginBottom: 4 }}>Messages Payload</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                        messages · payload · {inspectorModel.messageTranscript.items.length} message(s) · {inspectorModel.messageTranscript.items.reduce((total, item) => total + item.blocks.length, 0)} block(s)
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => copyToClipboard(inspectorModel.messageTranscript.content || '')}
                      style={{ padding: '5px 10px', fontSize: 11, flexShrink: 0 }}
                    >
                      Copy Transcript
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
                    {inspectorModel.messageTranscript.items.length > 0 ? inspectorModel.messageTranscript.items.map(item => {
                      const tone = getRoleTone(item.role);
                      const selected = item.id === selectedMessageId;
                      return (
                        <article
                          key={item.id}
                          ref={node => setMessageNode(item.id, node)}
                          style={{
                            border: selected ? '1px solid var(--blue)' : '1px solid var(--border)',
                            background: selected ? 'rgba(59, 130, 246, 0.06)' : 'var(--bg-surface)',
                            borderRadius: 8,
                            overflow: 'hidden',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                              <span
                                style={{
                                  padding: '2px 7px',
                                  borderRadius: 999,
                                  border: `1px solid ${tone.border}`,
                                  background: tone.background,
                                  color: tone.color,
                                  fontSize: 10,
                                  fontWeight: 850,
                                  textTransform: 'uppercase',
                                  letterSpacing: 0,
                                }}
                              >
                                {item.role}
                              </span>
                              <span style={{ fontSize: 12, fontWeight: 750, color: 'var(--text-primary)' }}>#{item.index + 1}</span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {item.blocks.length} block(s) · {item.chars.toLocaleString()} chars
                              </span>
                            </div>
                            <button
                              className="btn btn-ghost"
                              onClick={() => copyToClipboard(item.content || '')}
                              style={{ padding: '3px 8px', fontSize: 10, flexShrink: 0 }}
                            >
                              Copy
                            </button>
                          </div>
                          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {item.blocks.map(block => {
                              const blockTone = getBlockTone(block.displayKind);
                              return (
                                <div
                                  key={block.id}
                                  style={{
                                    position: 'relative',
                                    border: `1px solid ${blockTone.border}`,
                                    borderRadius: 7,
                                    background: blockTone.background,
                                    overflow: 'hidden',
                                    boxShadow: block.displayKind === 'text' ? 'none' : '0 1px 0 rgba(0,0,0,0.04)',
                                  }}
                                >
                                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: blockTone.rail }} />
                                  <div style={{ padding: '6px 10px 6px 12px', borderBottom: `1px solid ${blockTone.border}`, background: blockTone.header, color: 'var(--text-muted)', fontSize: 10, fontWeight: 800, fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span
                                      style={{
                                        color: blockTone.color,
                                        fontWeight: 900,
                                        letterSpacing: 0,
                                      }}
                                    >
                                      {blockTone.label}
                                    </span>
                                    <span style={{ color: 'var(--text-muted)' }}>{block.type}</span>
                                    <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>{block.chars.toLocaleString()} chars</span>
                                  </div>
                                  <pre style={{ margin: 0, padding: '11px 12px 11px 14px', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)' }}>
                                    {block.text || '(empty)'}
                                  </pre>
                                </div>
                              );
                            })}
                          </div>
                        </article>
                      );
                    }) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No messages are currently sent to the model.</div>
                    )}
                  </div>
                </>
              ) : selectedRow ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 850, color: 'var(--text-primary)', marginBottom: 4 }}>{selectedRow.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', wordBreak: 'break-word' }}>
                        {selectedRow.target} · {selectedRow.lifecycle} · {selectedRow.subtitle}
                      </div>
                      {selectedRow.cacheImpact && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
                          cache: {selectedRow.cacheImpact}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn btn-ghost"
                      onClick={() => copyToClipboard(selectedRow.content || '')}
                      style={{ padding: '5px 10px', fontSize: 11, flexShrink: 0 }}
                    >
                      Copy Section
                    </button>
                  </div>
                  <pre style={{ margin: 0, padding: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto' }}>
                    {selectedRow.content || '(empty)'}
                  </pre>
                </>
              ) : (
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No context sections available.</div>
              )}
            </section>
          </div>
        )}

        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0, fontSize: 12, color: 'var(--text-muted)' }}>
          <span>This view shows only the system prompt, messages, and tool schema sent to the model.</span>
          <button
            onClick={() => copyToClipboard(JSON.stringify(fullContext, null, 2))}
            style={{ marginLeft: 'auto', padding: '4px 12px', fontSize: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            Copy Payload JSON
          </button>
        </div>
      </div>
    </div>
  );
}
