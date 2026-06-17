import { useState, useEffect } from 'react';
import { DEFAULT_CONTEXT_WINDOW } from '../lib/modelContext.js';

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
  const [newModelConfig, setNewModelConfig] = useState({
    name: '',
    modelId: '',
    url: '',
    key: '',
    contextWindow: DEFAULT_CONTEXT_WINDOW
  });

  // 初始化：从后端加载模型列表
  useEffect(() => {
    fetch('http://localhost:3001/api/models')
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
    if (!newModelConfig.name || !newModelConfig.modelId || !newModelConfig.url || !newModelConfig.key) {
      alert('Please fill in all model information.');
      return;
    }
    const res = await fetch('http://localhost:3001/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newModelConfig)
    });
    const updated = await res.json();
    setModels(updated);
    setSelectedModel(updated[updated.length - 1]);
    setShowAddModel(false);
    setNewModelConfig({
      name: '',
      modelId: '',
      url: '',
      key: '',
      contextWindow: DEFAULT_CONTEXT_WINDOW
    });
  };

  return {
    models,
    selectedModel,
    setSelectedModel,
    showAddModel,
    setShowAddModel,
    newModelConfig,
    setNewModelConfig,
    handleAddModel,
  };
}
