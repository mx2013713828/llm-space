import { useState, useEffect } from 'react';
import { DEFAULT_CONTEXT_WINDOW } from '../lib/modelContext.js';
import { apiFetch } from '../lib/apiClient.js';

/**
 * useModels — 模型管理 Hook
 *
 * 负责从后端加载模型列表、选择模型、添加新模型并持久化到 .env。
 * 选中的模型 ID 通过 localStorage 跨会话保持。
 */
export function useModels() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [showAddModel, setShowAddModel] = useState(false);
  const [showEditModel, setShowEditModel] = useState(false);
  const [editModelConfig, setEditModelConfig] = useState(null);
  const [newModelConfig, setNewModelConfig] = useState({
    name: '',
    provider: '',
    protocol: 'openai',
    modelId: '',
    baseUrl: '',
    url: '',
    apiKey: '',
    key: '',
    contextWindow: DEFAULT_CONTEXT_WINDOW
  });

  // 初始化：从后端加载模型列表
  useEffect(() => {
    apiFetch('/api/models')
      .then(r => r.json())
      .then(data => {
        setModels(data);
        if (data.length > 0) {
          const savedId = localStorage.getItem('llm_selected_model_id');
          const found = data.find(m => m.id === savedId) || data[0];
          setSelectedModel(found);
        }
      });
  }, []);

  // 选中模型变化时同步到 localStorage
  useEffect(() => {
    if (selectedModel) {
      localStorage.setItem('llm_selected_model_id', selectedModel.id);
    }
  }, [selectedModel]);

  /**
   * 添加新模型配置并持久化到 .env
   */
  const handleAddModel = async () => {
    const baseUrl = newModelConfig.baseUrl || newModelConfig.url;
    const apiKey = newModelConfig.apiKey || newModelConfig.key;
    if (!newModelConfig.name || !newModelConfig.modelId || !baseUrl || !apiKey) {
      alert('Please fill in all model information.');
      return;
    }
    const res = await apiFetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newModelConfig,
        baseUrl,
        url: baseUrl,
        apiKey,
        key: apiKey,
      })
    });
    const updated = await res.json();
    setModels(updated);
    setSelectedModel(updated[updated.length - 1]);
    setShowAddModel(false);
    setNewModelConfig({
      name: '',
      provider: '',
      protocol: 'openai',
      modelId: '',
      baseUrl: '',
      url: '',
      apiKey: '',
      key: '',
      contextWindow: DEFAULT_CONTEXT_WINDOW
    });
  };

  const handleUpdateModel = async () => {
    const baseUrl = editModelConfig?.baseUrl || editModelConfig?.url;
    const apiKey = editModelConfig?.apiKey || editModelConfig?.key;
    if (!editModelConfig?.id || !editModelConfig.name || !editModelConfig.modelId || !baseUrl || !apiKey) {
      alert('Please fill in all model information.');
      return;
    }

    const res = await apiFetch(`/api/models/${editModelConfig.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...editModelConfig,
        baseUrl,
        url: baseUrl,
        apiKey,
        key: apiKey,
      })
    });
    const updated = await res.json();
    if (!res.ok) {
      alert(updated.error || 'Failed to update model.');
      return;
    }

    setModels(updated);
    const nextSelected = updated.find(m => m.id === editModelConfig.id) || updated[0] || null;
    setSelectedModel(nextSelected);
    setShowEditModel(false);
  };

  return {
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
  };
}
