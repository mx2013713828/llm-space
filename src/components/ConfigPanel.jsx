

export function ConfigPanel({
  models,
  selectedModel,
  setSelectedModel,
  showAddModel,
  setShowAddModel,
  newModelConfig,
  setNewModelConfig,
  handleAddModel,
  
  temperature,
  setTemperature,
  maxTokens,
  setMaxTokens,
  thinkingEnabled,
  setThinkingEnabled,
  
  systemPrompt,
  isPromptDirty,
  onPromptChange,
  onSavePrompt
}) {
  return (
    <div className="config-panel" style={{ width: 340, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* API 供应商选择与配置 */}
      <div className="card" style={{ padding: 14 }}>
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            API 核心配置
          </div>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => setShowAddModel(!showAddModel)}
          >
            + 添加模型
          </button>
        </div>

        {showAddModel && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px dashed var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>新增模型配置 (保存至 .env)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="显示名称 (如: 本地 DeepSeek)" value={newModelConfig.name} onChange={e => setNewModelConfig({ ...newModelConfig, name: e.target.value })} />
              <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Model ID (如: deepseek-chat)" value={newModelConfig.modelId} onChange={e => setNewModelConfig({ ...newModelConfig, modelId: e.target.value })} />
              <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Base URL (如: https://api.deepseek.com/anthropic)" value={newModelConfig.url} onChange={e => setNewModelConfig({ ...newModelConfig, url: e.target.value })} />
              <input className="input" type="password" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="API Key" value={newModelConfig.key} onChange={e => setNewModelConfig({ ...newModelConfig, key: e.target.value })} />
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <button className="btn btn-primary" style={{ flex: 1, padding: '4px' }} onClick={handleAddModel}>保存</button>
                <button className="btn btn-ghost" style={{ flex: 1, padding: '4px' }} onClick={() => setShowAddModel(false)}>取消</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, paddingLeft: 2 }}>选择可用模型</div>
            <div className="model-select-wrapper">
              <select
                className="model-select"
                value={selectedModel?.id || ''}
                onChange={e => {
                  const found = models.find(m => m.id === e.target.value);
                  if (found) setSelectedModel(found);
                }}
              >
                {models.length === 0 && <option value="">无可用模型，请添加</option>}
                {models.map(m => <option key={m.id} value={m.id}>{m.name} ({m.modelId})</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* 模型参数 */}
      <div className="card model-config-card">
        <div className="panel-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>
          模型参数
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 10, padding: '4px 0' }}>
          <input type="checkbox" checked={thinkingEnabled} onChange={e => setThinkingEnabled(e.target.checked)} />
          启用思维链 (Extended Thinking / Reasoner)
        </label>

        <div className="param-row" style={{ opacity: thinkingEnabled ? 0.5 : 1 }}>
          <span className="param-label">temp</span>
          <input type="range" className="param-slider" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} disabled={thinkingEnabled} />
          <span className="param-value">{temperature}</span>
        </div>
        <div className="param-row">
          <span className="param-label">max_tok</span>
          <input type="range" className="param-slider" min="1024" max="32000" step="1024" value={maxTokens} onChange={e => setMaxTokens(parseInt(e.target.value))} />
          <span className="param-value" style={{ width: 44 }}>{maxTokens}</span>
        </div>
      </div>

      {/* System Prompt */}
      <div className="card prompt-card" style={{ flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column' }}>
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Base System Prompt</span>
          {isPromptDirty && (
            <span style={{ color: 'var(--orange)', fontSize: 11, fontWeight: 'normal', display: 'flex', alignItems: 'center', gap: 4 }}>
              ● 有未保存的改动
            </span>
          )}
        </div>
        <textarea
          className="prompt-editor"
          style={{
            flex: 1,
            height: '100%',
            border: isPromptDirty ? '1px solid var(--orange)' : '1px solid var(--border)'
          }}
          value={systemPrompt}
          onChange={e => onPromptChange(e.target.value)}
        />
        <button
          className="btn"
          disabled={!isPromptDirty}
          onClick={onSavePrompt}
          style={{
            marginTop: 8,
            padding: '8px 12px',
            borderRadius: 4,
            border: 'none',
            backgroundColor: isPromptDirty ? 'var(--orange)' : 'var(--bg-surface)',
            color: isPromptDirty ? '#fff' : 'var(--text-muted)',
            cursor: isPromptDirty ? 'pointer' : 'not-allowed',
            fontWeight: 500,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s'
          }}
        >
          保存 Prompt (Save Prompt)
        </button>
      </div>
    </div>
  );
}
