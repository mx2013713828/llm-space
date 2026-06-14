import { useState, useEffect, useRef } from 'react';
import { FEATURE_SCHEMA, parseFeatures } from '../lib/FeatureSchema.js';

const SYSTEM_HIDDEN_TOOLS = [
  'write_todos',
  'create_task',
  'list_tasks',
  'get_task',
  'claim_task',
  'complete_task'
];

/**
 * Prompt Lab 页面
 * 用于配置当前 agent 的 system prompt 和 tools/skills
 */
export function PromptLabPage({ harness, onSave }) {
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt || '');
  const [selectedSkills, setSelectedSkills] = useState(harness.skills || []);
  const [selectedTools, setSelectedTools] = useState(harness.tools || []);
  const [availableTools, setAvailableTools] = useState([]);
  const [availableSkills, setAvailableSkills] = useState([]);
  const [activeTab, setActiveTab] = useState('editor');
  const [features, setFeatures] = useState(() => parseFeatures(harness.features));
  const [models, setModels] = useState([]);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved'
  // group 类特性的二级选项展开状态（key => boolean），默认全部折叠
  const [expandedGroups, setExpandedGroups] = useState({});

  // 任务系统自定义提示词临时缓冲区、展开状态和按钮应用反馈状态
  const [localPrompts, setLocalPrompts] = useState({});
  const [expandedPrompts, setExpandedPrompts] = useState({});
  const [promptSaveStatus, setPromptSaveStatus] = useState({});
  const timersRef = useRef({});

  useEffect(() => {
    const currentTimers = timersRef.current;
    return () => {
      // 卸载组件时清理所有悬挂的局部保存定时器，防止状态泄漏
      Object.values(currentTimers).forEach(clearTimeout);
    };
  }, []);


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

    fetch('http://localhost:3001/api/models')
      .then(r => r.json())
      .then(data => {
        if (active) {
          setModels(data);
        }
      })
      .catch(console.error);

    // 从 parseFeatures 解析后的 features state 读取，格式已统一，避免原始存档新旧格式歧义
    const initState = parseFeatures(harness.features);
    const isGlobalEnabled = !!(initState.enable_skills?.enabled && initState.enable_skills?.enable_global_skills);
    fetch(`http://localhost:3001/api/skills?global=${isGlobalEnabled}`)
      .then(r => r.json())
      .then(data => {
        if (active) {
          setAvailableSkills(data);
        }
      })
      .catch(console.error);

    return () => {
      active = false;
    };
  }, []);

  const getSkillUI = (id) => {
    const map = {
      'git-conventions': { icon: '📦', color: 'var(--blue)' },
      'jest-testing': { icon: '🧪', color: 'var(--green)' },
      'code-review': { icon: '🔍', color: 'var(--purple)' }
    };
    return map[id] || { icon: '✨', color: 'var(--cyan)' };
  };

  const PROMPT_TEMPLATES = [
    { name: 'Basic Chat Assistant', icon: '💬', prompt: 'You are a friendly AI assistant. Please answer the user\'s questions accurately and concisely.' },
    {
      name: 'Deep Researcher', icon: '🔬',
      prompt: `You are a professional researcher.\n\n<behaviors>\n<deep-research activate-when="User requests research on a topic">\n- Step 1: Call web_search for initial understanding\n- Step 2: Formulate research plan (write_todos)\n- Step 3: Execute research tasks step by step\n- Step 4: Synthesize and generate report\n</deep-research>\n</behaviors>`
    },
    {
      name: 'Code Engineer', icon: '💻',
      prompt: `You are a senior software engineer.\n\n## Principles\n- Understand requirements first, then write code\n- Write clear comments\n- Consider edge cases\n- Prefer functional programming`
    },
    {
      name: 'Task Execution Agent', icon: '🤖',
      prompt: `You are a task execution agent.\n\nExecution flow:\n1. Upon receiving a task, decompose it into subtasks using write_todos\n2. Execute each subtask in order\n3. Mark completion status\n4. Provide a summary after completing all tasks`
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

  const handleFeatureChange = (key, val) => {
    setFeatures(prev => {
      const updated = { ...prev };
      const meta = FEATURE_SCHEMA[key];
      
      if (meta.type === 'boolean') {
        updated[key] = val;
      } else if (meta.type === 'group') {
        updated[key] = {
          enabled: val,
          ...Object.keys(meta.children).reduce((acc, subKey) => {
            // 如果是重新开启父开关，且上一次父开关不是开启状态 (说明是从关闭变为开启)，直接重置为 defaultValue 确保体验干净
            acc[subKey] = val
              ? (prev[key]?.enabled ? (prev[key]?.[subKey] ?? meta.children[subKey].defaultValue) : meta.children[subKey].defaultValue)
              : meta.children[subKey].defaultValue;
            return acc;
          }, {})
        };
      }
      return updated;
    });

    // 触发联动特性的前端生命周期与副作用
    if (key === 'enable_skills') {
      // 父开关关闭时，收起 Skills 配置 Tab
      if (!val && activeTab === 'skills') {
        setActiveTab('editor');
      }
      // 父开关打开时，刷新 skills 列表
      // 子开关若没有被手动切换，handleSubFeatureChange 不会 fetch，需在此补全
      if (val) {
        const skillsMeta = FEATURE_SCHEMA['enable_skills'];
        // 父开关从关闭变为开启时，子开关会重置为 defaultValue（见上方 setFeatures 逻辑）
        // 此时 features state 尚未更新（setFeatures 是异步的），直接用 defaultValue
        const willGlobal = features['enable_skills']?.enabled
          ? !!(features['enable_skills']?.enable_global_skills ?? skillsMeta.children.enable_global_skills.defaultValue)
          : skillsMeta.children.enable_global_skills.defaultValue;
        fetch(`http://localhost:3001/api/skills?global=${willGlobal}`)
          .then(r => r.json())
          .then(data => setAvailableSkills(data))
          .catch(console.error);
      }
    }
  };

  const toggleGroupExpand = (key) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubFeatureChange = (parentKey, subKey, val) => {
    setFeatures(prev => ({
      ...prev,
      [parentKey]: {
        ...prev[parentKey],
        [subKey]: val
      }
    }));
    // 联动副作用：enable_global_skills 子开关变更时重新加载 skills 列表
    if (parentKey === 'enable_skills' && subKey === 'enable_global_skills') {
      fetch(`http://localhost:3001/api/skills?global=${val}`)
        .then(r => r.json())
        .then(data => setAvailableSkills(data))
        .catch(console.error);
    }
    // 联动约束：memory_extract 关闭时，memory_consolidate 自动静默关闭
    // （整理依赖提取，若没有提取就不该有整理）
    if (parentKey === 'enable_memory' && subKey === 'memory_extract' && !val) {
      setFeatures(prev => ({
        ...prev,
        enable_memory: {
          ...prev.enable_memory,
          memory_extract: false,
          memory_consolidate: false,
        }
      }));
    }
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
  let btnText = `Save to ${harness.name}`;
  let btnIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  );

  if (saveStatus === 'saving') {
    btnClass = "btn btn-save-saving";
    btnText = "Saving...";
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
    btnText = "Saved ✓";
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
          { key: 'editor', label: '✍️ System Prompt' },
          (features.enable_skills?.enabled !== false) && { key: 'skills', label: '✨ Skills Config' },
          { key: 'tools-edit', label: '🔧 Tools Mounting' },
          { key: 'features', label: '🔬 Experimental Features' },
          { key: 'templates', label: '📄 Templates' },
        ].filter(Boolean).map(tab => (
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
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Current System Prompt</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {systemPrompt.length} chars / ≈{Math.ceil(systemPrompt.length/4)} tokens
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
                placeholder="Enter system prompt..."
              />
            </div>
          </div>
        )}

        {/* Skills 配置 */}
        {activeTab === 'skills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '12px 16px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-secondary)' }}>
              💡 Skills are behavioral rule snippets embedded in the system prompt. When enabled, the agent will automatically trigger the corresponding workflow under specific conditions.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {availableSkills.map(skill => {
                const active = selectedSkills.includes(skill.id);
                const { icon, color } = getSkillUI(skill.id);
                return (
                  <div
                    key={skill.id}
                    className="card"
                    onClick={() => toggleSkill(skill.id)}
                    style={{
                      padding: 16, cursor: 'pointer',
                      borderColor: active ? `${color}50` : 'var(--border)',
                      background: active ? `${color}08` : 'var(--bg-card)',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 22 }}>{icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: active ? color : 'var(--text-primary)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {skill.name}
                          {skill.isGlobal && (
                            <span style={{ fontSize: 9, background: 'var(--blue)', color: '#fff', padding: '1px 5px', borderRadius: 4, fontWeight: 'bold' }}>🌐 Global</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{skill.desc}</div>
                      </div>
                      <div style={{ marginLeft: 'auto' }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: 4,
                          border: `2px solid ${active ? color : 'var(--border-light)'}`,
                          background: active ? color : 'transparent',
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
                        fontSize: 11, color: color, fontWeight: 500,
                        padding: '3px 8px', background: `${color}15`,
                        borderRadius: 99, display: 'inline-flex', alignItems: 'center', gap: 4,
                      }}>
                        ✓ Activated
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedSkills.length > 0 && (
              <div className="card" style={{ padding: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
                  Currently Active Skills
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
              🔧 Tools Config. Select the standard tools you want to mount for the LLM.
            </div>
            {availableTools.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading standard tools from backend...</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
                {availableTools
                  .filter(tool => !SYSTEM_HIDDEN_TOOLS.includes(tool.name))
                  .map(tool => {
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
              🔬 Advanced feature switches for the Agent architecture interactive lab. You can freely enable or disable underlying architectural capabilities here.
            </div>

            {Object.entries(FEATURE_SCHEMA).map(([key, meta]) => {
              if (meta.type === 'boolean') {
                return (
                  <div key={key} className="card" style={{ padding: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={!!features[key]}
                        onChange={(e) => handleFeatureChange(key, e.target.checked)}
                        style={{ transform: 'scale(1.2)', marginTop: 4 }}
                      />
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{meta.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                          {meta.description}
                        </div>
                      </div>
                    </label>
                  </div>
                );
              } else if (meta.type === 'group') {
                const isParentEnabled = !!(features[key]?.enabled ?? features[key]);
                const isExpanded = !!expandedGroups[key];
                return (
                  <div key={key} className="card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {/* 一级行：开关 + 标签 + 展开箭头 */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <input
                        type="checkbox"
                        checked={isParentEnabled}
                        onChange={(e) => handleFeatureChange(key, e.target.checked)}
                        style={{ transform: 'scale(1.2)', marginTop: 4, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{meta.label}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                          {meta.description}
                        </div>
                      </div>
                      {/* 展开/折叠切换按钮 */}
                      <button
                        onClick={() => toggleGroupExpand(key)}
                        title={isExpanded ? 'Collapse sub-options' : 'Expand sub-options'}
                        style={{
                          flexShrink: 0,
                          background: 'none', border: 'none', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 12,
                          padding: '2px 6px', borderRadius: 4,
                          display: 'flex', alignItems: 'center', gap: 3,
                          marginTop: 2,
                          transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                      >
                        <span style={{ display: 'inline-block', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>▶</span>
                        <span>{isExpanded ? 'Collapse' : `${Object.keys(meta.children).length} items`}</span>
                      </button>
                    </div>

                    {/* 二级配置：默认折叠，展开后才显示；父开关关闭时置灰锁定 */}
                    {isExpanded && (
                      <div
                        style={{
                          paddingLeft: 24,
                          marginTop: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 14,
                          borderLeft: '2px solid var(--border)',
                          opacity: isParentEnabled ? 1 : 0.4,
                          pointerEvents: isParentEnabled ? 'auto' : 'none',
                          transition: 'opacity 0.2s ease-in-out'
                        }}
                      >
                        {Object.entries(meta.children).map(([subKey, subMeta]) => {
                          if (subMeta.type === 'select') {
                            const selectedValue = features[key]?.[subKey] || subMeta.defaultValue;
                            const hasOptions = !!subMeta.options;
                            const isDisabled = hasOptions 
                              ? !isParentEnabled 
                              : (!isParentEnabled || (subKey === 'fallback_model_id' && !features[key]?.fallback_model));

                            return (
                              <div key={subKey} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, width: '100%' }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{subMeta.label}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{subMeta.description}</div>
                                <select
                                  disabled={isDisabled}
                                  value={selectedValue}
                                  onChange={(e) => handleSubFeatureChange(key, subKey, e.target.value)}
                                  className="model-select"
                                  style={{ width: '100%', fontSize: 11, padding: '4px 8px', height: 28 }}
                                >
                                  {hasOptions ? (
                                    subMeta.options.map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))
                                  ) : (
                                    <>
                                      <option value="">{models.length === 0 ? '-- Loading fallback models... --' : '-- Select fallback model --'}</option>
                                      {models.map((m, idx) => (
                                        <option key={m.id || m.modelId || idx} value={m.id}>{m.name} ({m.modelId})</option>
                                      ))}
                                    </>
                                  )}
                                </select>
                                {!hasOptions && features[key]?.fallback_model && !selectedValue && (
                                  <div style={{ color: 'var(--orange)', fontSize: 10 }}>⚠️ Please select a valid fallback model to enable failover</div>
                                )}
                              </div>
                            );
                          }

                          if (subMeta.type === 'text_area') {
                            // 仅在匹配对应模式时，渲染指引词定制卡片
                            if (subKey === 'todo_prompt' && features[key]?.mode !== 'todo') {
                              return null;
                            }
                            if (subKey === 'task_system_prompt' && features[key]?.mode !== 'task_system') {
                              return null;
                            }

                            const currentSavedValue = features[key]?.[subKey] ?? subMeta.defaultValue;
                            const currentInputValue = localPrompts[subKey] !== undefined ? localPrompts[subKey] : currentSavedValue;
                            const isExpanded = !!expandedPrompts[subKey];
                            const isSaved = promptSaveStatus[subKey] === 'saved';

                            return (
                              <div key={subKey} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, width: '100%' }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{subMeta.label}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginBottom: 4 }}>{subMeta.description}</div>
                                
                                <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                                  {/* 折叠手风琴头部 */}
                                  <div 
                                    onClick={() => setExpandedPrompts(prev => ({ ...prev, [subKey]: !prev[subKey] }))}
                                    style={{
                                      padding: '8px 12px',
                                      background: 'var(--bg-elevated)',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      fontSize: 11,
                                      fontWeight: 500,
                                      color: 'var(--text-secondary)',
                                      userSelect: 'none'
                                    }}
                                  >
                                    <span>⚙️ Custom System Guidelines (XML)</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                                      {isExpanded ? 'Collapse ▲' : 'Edit ▶'}
                                    </span>
                                  </div>

                                  {/* 折叠手风琴编辑区域 */}
                                  {isExpanded && (
                                    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg-card)' }}>
                                      <textarea
                                        value={currentInputValue}
                                        onChange={(e) => setLocalPrompts(prev => ({ ...prev, [subKey]: e.target.value }))}
                                        style={{
                                          width: '100%',
                                          minHeight: '200px',
                                          maxHeight: '500px',
                                          fontFamily: 'var(--font-mono)',
                                          fontSize: '11px',
                                          lineHeight: '1.5',
                                          padding: '8px 10px',
                                          background: 'var(--bg-base)',
                                          color: 'var(--text-primary)',
                                          border: '1px solid var(--border)',
                                          borderRadius: 'var(--radius-sm)',
                                          outline: 'none',
                                          resize: 'vertical',
                                          overflowY: 'auto'
                                        }}
                                        placeholder="Enter custom guidelines in XML format..."
                                      />
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <button
                                          type="button"
                                          disabled={!isParentEnabled}
                                          onClick={() => {
                                            handleSubFeatureChange(key, subKey, currentInputValue);
                                            setPromptSaveStatus(prev => ({ ...prev, [subKey]: 'saved' }));
                                            
                                            if (timersRef.current[subKey]) {
                                              clearTimeout(timersRef.current[subKey]);
                                            }
                                            timersRef.current[subKey] = setTimeout(() => {
                                              setPromptSaveStatus(prev => ({ ...prev, [subKey]: 'idle' }));
                                              delete timersRef.current[subKey];
                                            }, 1500);
                                          }}
                                          className={`btn ${isSaved ? 'btn-save-saved' : 'btn-primary'}`}
                                          style={{ padding: '4px 12px', fontSize: 11, height: 26 }}
                                        >
                                          {isSaved ? 'Applied ✓' : '💾 Save Changes'}
                                        </button>
                                        <button
                                          type="button"
                                          disabled={!isParentEnabled}
                                          onClick={() => {
                                            setLocalPrompts(prev => ({ ...prev, [subKey]: subMeta.defaultValue }));
                                          }}
                                          className="btn"
                                          style={{ padding: '4px 12px', fontSize: 11, height: 26, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                                        >
                                          ↩️ Reset
                                        </button>
                                        
                                        {/* 状态差异指示器 */}
                                        {currentInputValue !== currentSavedValue && (
                                          <span style={{ fontSize: 10, color: 'var(--orange)' }}>
                                            ⚠️ Changes not saved yet
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }

                          const isSubEnabled = isParentEnabled && !!features[key]?.[subKey];
                          return (
                            <label key={subKey} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, cursor: isParentEnabled ? 'pointer' : 'not-allowed' }}>
                              <input
                                type="checkbox"
                                disabled={!isParentEnabled}
                                checked={isSubEnabled}
                                onChange={(e) => handleSubFeatureChange(key, subKey, e.target.checked)}
                                style={{ transform: 'scale(1.1)', marginTop: 3 }}
                              />
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 550, color: 'var(--text-secondary)' }}>{subMeta.label}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                                  {subMeta.description}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }
              return null;
            })}
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
                    Use Template
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
