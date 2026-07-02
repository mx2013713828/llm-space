

import { DEFAULT_CONTEXT_WINDOW } from '../lib/modelContext.js';

export function ConfigPanel({
  models,
  selectedModel,
  setSelectedModel,
  showAddModel,
  setShowAddModel,
  showEditModel,
  setShowEditModel,
  newModelConfig,
  setNewModelConfig,
  editModelConfig,
  setEditModelConfig,
  handleAddModel,
  handleUpdateModel,
  
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
  const renderModelFields = (modelConfig, setModelConfig) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Display Name (e.g. Local DeepSeek)" value={modelConfig.name} onChange={e => setModelConfig({ ...modelConfig, name: e.target.value })} />
      <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Provider (e.g. kimi, glm, minimax, deepseek)" value={modelConfig.provider || ''} onChange={e => setModelConfig({ ...modelConfig, provider: e.target.value })} />
      <select
        className="input"
        style={{ fontSize: 11, padding: '6px 8px' }}
        value={modelConfig.protocol || 'openai'}
        onChange={e => setModelConfig({ ...modelConfig, protocol: e.target.value })}
      >
        <option value="openai">OpenAI-compatible</option>
        <option value="anthropic">Anthropic-compatible</option>
      </select>
      <input className="input" style={{ fontSize: 11, padding: '6px 8px' }} placeholder="Model ID (e.g. deepseek-chat)" value={modelConfig.modelId} onChange={e => setModelConfig({ ...modelConfig, modelId: e.target.value })} />
      <input
        className="input"
        style={{ fontSize: 11, padding: '6px 8px' }}
        placeholder="Base URL (e.g. https://api.moonshot.ai/v1)"
        value={modelConfig.baseUrl || modelConfig.url || ''}
        onChange={e => setModelConfig({ ...modelConfig, baseUrl: e.target.value, url: e.target.value })}
      />
      <input
        className="input"
        type="number"
        min="1"
        step="1000"
        style={{ fontSize: 11, padding: '6px 8px' }}
        placeholder="Context Window (e.g. 128000)"
        value={modelConfig.contextWindow}
        onChange={e => setModelConfig({ ...modelConfig, contextWindow: parseInt(e.target.value, 10) || '' })}
      />
      <input
        className="input"
        type="password"
        style={{ fontSize: 11, padding: '6px 8px' }}
        placeholder="API Key"
        value={modelConfig.apiKey || modelConfig.key || ''}
        onChange={e => setModelConfig({ ...modelConfig, apiKey: e.target.value, key: e.target.value })}
      />
    </div>
  );

  return (
    <div className="config-panel" style={{ width: 340, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* API 供应商选择与配置 */}
      <div className="card" style={{ padding: 14 }}>
        <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            Model & Configuration
          </div>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: 11 }}
            onClick={() => {
              setShowAddModel(!showAddModel);
              if (!showAddModel) setShowEditModel(false);
            }}
          >
            + Add Model
          </button>
        </div>

        {showAddModel && (
          <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px dashed var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Add Model Config (Saved to .env)</div>
            {renderModelFields(newModelConfig, setNewModelConfig)}
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              <button className="btn btn-primary" style={{ flex: 1, padding: '4px' }} onClick={handleAddModel}>Save</button>
              <button className="btn btn-ghost" style={{ flex: 1, padding: '4px' }} onClick={() => setShowAddModel(false)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, paddingLeft: 2 }}>LLM Model</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <div className="model-select-wrapper" style={{ flex: 1 }}>
              <select
                className="model-select"
                value={selectedModel?.id || ''}
                onChange={e => {
                  const found = models.find(m => m.id === e.target.value);
                  if (found) setSelectedModel(found);
                }}
              >
                {models.length === 0 && <option value="">No models available, please add one</option>}
                {models.map(m => <option key={m.id} value={m.id}>{m.name} ({m.modelId})</option>)}
              </select>
              </div>
              <button
                className="btn btn-ghost"
                disabled={!selectedModel}
                style={{ padding: '0 10px', fontSize: 11, height: 32 }}
                onClick={() => {
                  setShowEditModel(!showEditModel);
                  setShowAddModel(false);
                  if (selectedModel) {
                    setEditModelConfig({
                      ...selectedModel,
                      contextWindow: selectedModel.contextWindow || DEFAULT_CONTEXT_WINDOW
                    });
                  }
                }}
              >
                Edit
              </button>
            </div>
          </div>
          {showEditModel && editModelConfig && (
            <div style={{ marginTop: 10, padding: 12, background: 'var(--bg-base)', borderRadius: 6, border: '1px dashed var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>Edit Model Config (Saved to .env)</div>
              {renderModelFields(editModelConfig, setEditModelConfig)}
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <button className="btn btn-primary" style={{ flex: 1, padding: '4px' }} onClick={handleUpdateModel}>Save Changes</button>
                <button className="btn btn-ghost" style={{ flex: 1, padding: '4px' }} onClick={() => setShowEditModel(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 模型参数 */}
      <div className="card model-config-card">
        <div className="panel-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" /></svg>
          Parameters
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 10, padding: '4px 0' }}>
          <input type="checkbox" checked={thinkingEnabled} onChange={e => setThinkingEnabled(e.target.checked)} />
          Reasoning / Extended Thinking
        </label>

        <div className="param-row" style={{ opacity: thinkingEnabled ? 0.5 : 1 }}>
          <span className="param-label">Temperature</span>
          <input type="range" className="param-slider" min="0" max="2" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} disabled={thinkingEnabled} />
          <span className="param-value">{temperature}</span>
        </div>
        <div className="param-row">
          <span className="param-label">Output Tokens</span>
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
              ● Unsaved changes
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
          Save Prompt
        </button>
      </div>
    </div>
  );
}
