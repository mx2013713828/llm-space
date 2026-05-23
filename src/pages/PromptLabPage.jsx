import { useState, useEffect } from 'react';

/**
 * Prompt Lab 页面
 * 用于配置当前 agent 的 system prompt 和 tools/skills
 */
export function PromptLabPage({ harness, onSave }) {
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt || '');
  const [selectedSkills, setSelectedSkills] = useState(harness.skills || []);
  const [selectedTools, setSelectedTools] = useState(harness.tools || []);
  const [availableTools, setAvailableTools] = useState([]);
  const [activeTab, setActiveTab] = useState('editor');
  const [features, setFeatures] = useState(harness.features || {});
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'

  useEffect(() => {
    let active = true;
    fetch('http://localhost:3001/api/tools')
      .then(r => r.json())
      .then(data => {
        if (active) {
          setAvailableTools(data);
        }
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, []);

  const AVAILABLE_SKILLS = [
    { id: 'deep-research', name: 'deep-research', desc: '激活深度调研工作流', icon: '🔬', color: 'var(--blue)' },
    { id: 'web-tools', name: 'web-tools', desc: '启用网络搜索与抓取', icon: '🌐', color: 'var(--cyan)' },
    { id: 'todo-manager', name: 'todo-manager', desc: '启用任务分解与追踪', icon: '✅', color: 'var(--green)' },
    { id: 'code-executor', name: 'code-executor', desc: '允许执行代码', icon: '⚡', color: 'var(--amber)' },
    { id: 'memory', name: 'memory', desc: '持久化记忆系统', icon: '🧠', color: 'var(--purple)' },
    { id: 'structured-output', name: 'structured-output', desc: '结构化输出格式', icon: '📋', color: 'var(--orange)' },
  ];

  const PROMPT_TEMPLATES = [
    { name: '基础聊天助手', icon: '💬', prompt: '你是一个友好的智能助手，请准确、简洁地回答用户的问题。' },
    {
      name: '深度研究员', icon: '🔬',
      prompt: `你是一个专业研究员。\n\n<behaviors>\n<deep-research activate-when="用户要求研究某个话题">\n- Step 1: 调用 web_search 初步了解\n- Step 2: 制定研究计划 (write_todos)\n- Step 3: 逐项执行研究任务\n- Step 4: 综合生成报告\n</deep-research>\n</behaviors>`
    },
    {
      name: '代码工程师', icon: '💻',
      prompt: `你是一个高级软件工程师。\n\n## 原则\n- 先理解需求，再写代码\n- 写清晰的注释\n- 考虑边界情况\n- 优先使用函数式编程`
    },
    {
      name: '任务执行 Agent', icon: '🤖',
      prompt: `你是一个任务执行 agent。\n\n执行流程：\n1. 收到任务后，用 write_todos 分解为子任务\n2. 按顺序执行每个子任务\n3. 标记完成状态\n4. 完成所有任务后给出汇总`
    },
  ];

  const toggleSkill = (skillId) => {
    setSelectedSkills(prev =>
      prev.includes(skillId) ? prev.filter(s => s !== skillId) : [...prev, skillId]
    );
  };

  const toggleTool = (tool) => {
    setSelectedTools(prev => {
      if (prev.some(t => t.name === tool.name)) {
        return prev.filter(t => t.name !== tool.name);
      } else {
        return [...prev, tool];
      }
    });
  };

  useEffect(() => {
    let timer;
    if (saveStatus === 'saved') {
      timer = setTimeout(() => {
        setSaveStatus('idle');
      }, 1500);
    }
    return () => clearTimeout(timer);
  }, [saveStatus]);

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      if (onSave) {
        await onSave({
          ...harness,
          systemPrompt: systemPrompt,
          skills: selectedSkills,
          tools: selectedTools,
          features: features
        });
      }
      setSaveStatus('saved');
    } catch (err) {
      console.error(err);
      setSaveStatus('idle');
    }
  };

  let btnClass = "btn btn-primary";
  let btnText = `保存至 ${harness.name}`;
  let btnIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  );

  if (saveStatus === 'saving') {
    btnClass = "btn btn-save-saving";
    btnText = "正在保存...";
    btnIcon = (
      <svg className="animate-spin-fast" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <line x1="12" y1="2" x2="12" y2="6"/>
        <line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
        <line x1="2" y1="12" x2="6" y2="12"/>
        <line x1="18" y1="12" x2="22" y2="12"/>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
      </svg>
    );
  } else if (saveStatus === 'saved') {
    btnClass = "btn btn-save-saved";
    btnText = "已保存 ✓";
    btnIcon = (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    );
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
      {/* Tab 切换 */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 16px', alignItems: 'center',
        background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
      }}>
        {[
          { key: 'editor', label: '✍️ Prompt 编辑器' },
          { key: 'skills', label: '✨ Skills 配置' },
          { key: 'tools-edit', label: '🔧 Tools 挂载' },
          { key: 'features', label: '🔬 实验特性' },
          { key: 'templates', label: '📄 模板库' },
        ].map(tab => (
          <button
            key={tab.key}
            className={`topbar-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        
        <div style={{ marginLeft: 'auto' }}>
          <button 
            className={btnClass} 
            onClick={handleSave}
            disabled={saveStatus !== 'idle'}
          >
            {btnIcon}
            <span>{btnText}</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

        {/* Prompt 编辑器 */}
        {activeTab === 'editor' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 3, height: 16, borderRadius: 99, background: 'var(--blue)' }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>当前 System Prompt</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {systemPrompt.length}字 / ≈{Math.ceil(systemPrompt.length/4)} tokens
                </span>
              </div>
              <textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                style={{
                  flex: 1, minHeight: 400, resize: 'none',
                  background: 'var(--bg-base)', border: `1px solid var(--border)`,
                  borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.65,
                  padding: 12, outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                }}
                onFocus={e => { e.target.style.borderColor = 'var(--blue)'; e.target.style.boxShadow = `0 0 0 2px rgba(59, 130, 246, 0.2)`; }}
                onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
                placeholder="输入 system prompt..."
              />
            </div>
          </div>
        )}

        {/* Skills 配置 */}
        {activeTab === 'skills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
              💡 Skills 是嵌入到 system prompt 中的行为规则片段。启用后，agent 会在特定条件下自动触发对应的工作流。
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {AVAILABLE_SKILLS.map(skill => {
                const active = selectedSkills.includes(skill.id);
                return (
                  <div
                    key={skill.id}
                    className="card"
                    onClick={() => toggleSkill(skill.id)}
                    style={{
                      padding: 16, cursor: 'pointer',
                      borderColor: active ? `${skill.color}50` : 'var(--border)',
                      background: active ? `${skill.color}08` : 'var(--bg-card)',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 22 }}>{skill.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: active ? skill.color : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                          {skill.name}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{skill.desc}</div>
                      </div>
                      <div style={{ marginLeft: 'auto' }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 4,
                          border: `2px solid ${active ? skill.color : 'var(--border-light)'}`,
                          background: active ? skill.color : 'transparent',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, color: '#fff',
                          transition: 'all 0.2s',
                        }}>
                          {active && '✓'}
                        </div>
                      </div>
                    </div>
                    {active && (
                      <div style={{
                        fontSize: 11, color: skill.color, fontWeight: 500,
                        padding: '3px 8px', background: `${skill.color}15`,
                        borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        ✓ 已激活
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedSkills.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                  当前激活的 Skills
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {selectedSkills.map(s => (
                    <span key={s} className="badge badge-purple">✨ {s}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tools 配置 */}
        {activeTab === 'tools-edit' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
              🔧 Tools 配置。选择你要挂载给大模型的标准工具。
            </div>
            {availableTools.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>正在从后端加载标准工具...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                {availableTools.map(tool => {
                  const active = selectedTools.some(t => t.name === tool.name);
                  return (
                    <div
                      key={tool.name}
                      className="card"
                      onClick={() => toggleTool(tool)}
                      style={{
                        padding: 16, cursor: 'pointer',
                        borderColor: active ? 'var(--blue)' : 'var(--border)',
                        background: active ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-card)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 22 }}>🔧</span>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--blue)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                            {tool.name}
                          </div>
                        </div>
                        <div style={{ marginLeft: 'auto', fontSize: 16, color: active ? 'var(--blue)' : 'var(--text-muted)' }}>
                          {active ? '☑' : '☐'}
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tool.description}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 实验特性配置 */}
        {activeTab === 'features' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
              🔬 这里是 Agent 架构互动实验室的高级特性开关。你可以在这里自由开启或关闭各项底层架构能力。
            </div>
            
            <div className="card" style={{ padding: 16 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={features.parallel_tool_execution || false}
                  onChange={e => setFeatures({ ...features, parallel_tool_execution: e.target.checked })}
                  style={{ transform: 'scale(1.2)', marginTop: 4 }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>阶段一：并行工具执行 (Parallel Tool Execution)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                    开启后，如果大模型在同一回合输出了多个 tool call（如同时查寻多个网页或读多个文件），底层 Harness 将使用并发（Promise.all）执行，大幅缩短等待时间。关闭则退回传统的串行等待。
                  </div>
                </div>
              </label>
            </div>

            <div className="card" style={{ padding: 16 }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={features.context_compaction !== false}
                  onChange={e => setFeatures({ ...features, context_compaction: e.target.checked })}
                  style={{ transform: 'scale(1.2)', marginTop: 4 }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>阶段二：上下文压缩与实时折叠 (Context Compaction)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                    开启后，当上下文长度或回合数超过阈值时，底层 Harness 会将已结算的思维链 (thinking block) 替换为固定的占位符 `[Thinking folded]`，以保证前缀一致，友好兼容 Prompt Cache 并节省大量 Token 消耗。同时对旧历史中的冗余数据进行清洗折叠。关闭则保留完整思维链与数据上下文。
                  </div>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* 模板库 */}
        {activeTab === 'templates' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 14 }}>
            {PROMPT_TEMPLATES.map((tmpl, idx) => (
              <div key={idx} className="card" style={{ padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{ fontSize: 20 }}>{tmpl.icon}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{tmpl.name}</span>
                  <button
                    className="btn btn-primary"
                    style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 11 }}
                    onClick={() => { setSystemPrompt(tmpl.prompt); setActiveTab('editor'); }}
                  >
                    使用此模板
                  </button>
                </div>
                <pre style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--text-secondary)', background: 'var(--bg-base)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
                  padding: 10, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  maxHeight: 160, overflow: 'hidden',
                }}>
                  {tmpl.prompt}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
