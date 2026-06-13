# Task System Prompt Customizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the frontend customizer interface in PromptLabPage.jsx for todo_prompt and task_system_prompt text_area options, featuring nested accordion cards, local buffers, and save/reset controls.

**Architecture:** Add React states for accordion tracking, input buffering, and success status within PromptLabPage.jsx. Conditionally filter and render text_area inputs, ensuring that custom inputs only overwrite global features upon explicit saving, and can be reset to schemas default.

**Tech Stack:** React 18 (useState, useEffect), Vanilla CSS, custom FeatureSchema metadata.

---

### Task 1: PromptLabPage React States and Lifecycle Integration

**Files:**
- Modify: `src/pages/PromptLabPage.jsx`

- [ ] **Step 1: Declare localPrompts, expandedPrompts, and promptSaveStatus states**

In [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx) around line 29, add the state declarations:
```javascript
  // 任务系统自定义提示词临时缓冲区、展开状态和按钮应用反馈状态
  const [localPrompts, setLocalPrompts] = useState({});
  const [expandedPrompts, setExpandedPrompts] = useState({});
  const [promptSaveStatus, setPromptSaveStatus] = useState({});
```

- [ ] **Step 2: Add useEffect listener on harness.id to discard unsaved buffer**

In [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx) around line 66, add the lifecycle synchronization hook:
```javascript
  useEffect(() => {
    // 切换 Harness 时，彻底重置缓冲区和局部展开状态
    setLocalPrompts({});
    setExpandedPrompts({});
    setPromptSaveStatus({});
  }, [harness.id]);
```

- [ ] **Step 3: Commit these state updates**

```bash
git add src/pages/PromptLabPage.jsx
git commit -m "feat: declare localPrompts, expandedPrompts states and harness sync effect"
```

---

### Task 2: Implement Conditional Rendering and Accordion UI for text_area Subfeatures

**Files:**
- Modify: `src/pages/PromptLabPage.jsx`

- [ ] **Step 1: Implement conditional text_area block inside FEATURE_SCHEMA.map children renderer**

In [PromptLabPage.jsx](file:///Users/mayufeng/fast_myf/LLM-Learning/llm-space/src/pages/PromptLabPage.jsx) around line 521, modify the children loop to handle `subMeta.type === 'text_area'` configurations. Insert the text_area handler block:

```javascript
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
                                    <span>⚙️ 自定义系统行为指引词 (XML 配置)</span>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                                      {isExpanded ? '收起 ▲' : '展开编辑 ▶'}
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
                                        placeholder="输入自定义 XML 格式的行为指引..."
                                      />
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <button
                                          type="button"
                                          disabled={!isParentEnabled}
                                          onClick={() => {
                                            handleSubFeatureChange(key, subKey, currentInputValue);
                                            setPromptSaveStatus(prev => ({ ...prev, [subKey]: 'saved' }));
                                            setTimeout(() => {
                                              setPromptSaveStatus(prev => ({ ...prev, [subKey]: 'idle' }));
                                            }, 1500);
                                          }}
                                          className={`btn ${isSaved ? 'btn-save-saved' : 'btn-primary'}`}
                                          style={{ padding: '4px 12px', fontSize: 11, height: 26 }}
                                        >
                                          {isSaved ? '已应用 ✓' : '💾 保存修改'}
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
                                          ↩️ 恢复默认
                                        </button>
                                        
                                        {/* 状态差异指示器 */}
                                        {currentInputValue !== currentSavedValue && (
                                          <span style={{ fontSize: 10, color: 'var(--orange)' }}>
                                            ⚠️ 更改尚未保存生效
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          }
```

- [ ] **Step 2: Commit UI updates**

```bash
git add src/pages/PromptLabPage.jsx
git commit -m "feat: render text_area subfeatures as collapsible accordion with local buffers"
```
