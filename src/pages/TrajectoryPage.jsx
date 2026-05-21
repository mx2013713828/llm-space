import { useState } from 'react';
import { useModels } from '../hooks/useModels';
import { useAgentLoop } from '../hooks/useAgentLoop';
import { useAutoScroll } from '../hooks/useAutoScroll';

import { ConfigPanel } from '../components/ConfigPanel';
import { TrajectoryView } from '../components/TrajectoryView';
import { ContextInspector } from '../components/ContextInspector';

export function TrajectoryPage({ harness, savedSession, onSessionUpdate, onSessionReset }) {
  // 1. 模型管理 Hook
  const {
    models,
    selectedModel,
    setSelectedModel,
    showAddModel,
    setShowAddModel,
    newModelConfig,
    setNewModelConfig,
    handleAddModel
  } = useModels();

  // 2. 本地配置状态
  const [temperature, setTemperature] = useState(harness.model.temperature || 1.0);
  const [maxTokens, setMaxTokens] = useState(harness.model.max_tokens || 8000);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt);

  // 3. UI 状态
  const [activeRightTab, setActiveRightTab] = useState('trajectory');
  const [showContextInspector, setShowContextInspector] = useState(false);

  // 4. Agent 核心逻辑 Hook
  const agentState = useAgentLoop({
    harness,
    savedSession,
    selectedModel,
    temperature,
    maxTokens,
    thinkingEnabled,
    systemPrompt,
    onSessionUpdate,
    onSessionReset
  });

  // 5. 自动滚动 Hook
  const { chatEndRef, scrollContainerRef } = useAutoScroll(agentState.messages, activeRightTab);

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, height: '100%', overflow: 'hidden' }}>
      {/* 左侧配置面板 */}
      <ConfigPanel
        models={models}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        showAddModel={showAddModel}
        setShowAddModel={setShowAddModel}
        newModelConfig={newModelConfig}
        setNewModelConfig={setNewModelConfig}
        handleAddModel={handleAddModel}
        
        temperature={temperature}
        setTemperature={setTemperature}
        maxTokens={maxTokens}
        setMaxTokens={setMaxTokens}
        thinkingEnabled={thinkingEnabled}
        setThinkingEnabled={setThinkingEnabled}
        
        systemPrompt={systemPrompt}
        setSystemPrompt={setSystemPrompt}
      />

      {/* 右侧轨迹视图 */}
      <TrajectoryView
        activeRightTab={activeRightTab}
        setActiveRightTab={setActiveRightTab}
        messages={agentState.messages}
        todos={agentState.todos}
        turns={agentState.turns}
        isRunning={agentState.isRunning}
        currentTokens={agentState.currentTokens}
        cacheStats={agentState.cacheStats}
        contextTokens={agentState.contextTokens}
        inputText={agentState.inputText}
        setInputText={agentState.setInputText}
        textareaRef={agentState.textareaRef}
        handleInputChange={agentState.handleInputChange}
        handleKeyDown={agentState.handleKeyDown}
        handleSend={agentState.handleSend}
        chatEndRef={chatEndRef}
        scrollContainerRef={scrollContainerRef}
        setShowContextInspector={setShowContextInspector}
        handleResetSession={agentState.handleResetSession}
        loopCount={agentState.loopCount}
      />

      {/* 上下文检查器模态框 */}
      {showContextInspector && (
        <ContextInspector
          messages={agentState.messages}
          systemPrompt={systemPrompt}
          tools={harness.tools}
          setShowContextInspector={setShowContextInspector}
          thinkingEnabled={thinkingEnabled}
        />
      )}
    </div>
  );
}
