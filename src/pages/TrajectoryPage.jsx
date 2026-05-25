import { useState, useEffect, useRef } from 'react';
import { useModels } from '../hooks/useModels';
import { useAgentLoop } from '../hooks/useAgentLoop';
import { useAutoScroll } from '../hooks/useAutoScroll';

import { ConfigPanel } from '../components/ConfigPanel';
import { TrajectoryView } from '../components/TrajectoryView';
import { ContextInspector } from '../components/ContextInspector';

export function TrajectoryPage({ harness, savedSession, onSessionUpdate, onSessionReset, onHarnessUpdate }) {
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
  const [temperature, setTemperature] = useState(harness.model?.temperature || 1.0);
  const [maxTokens, setMaxTokens] = useState(harness.model?.max_tokens || 8000);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt);

  const [allSkills, setAllSkills] = useState([]);
  useEffect(() => {
    if (harness?.features?.enable_skills === false) {
      setAllSkills([]);
      return;
    }
    const isGlobal = harness?.features?.enable_global_skills === true;
    fetch(`http://localhost:3001/api/skills?global=${isGlobal}`)
      .then(r => r.json())
      .then(data => setAllSkills(data))
      .catch(console.error);
  }, [harness]);

  // 监听 harness 的变化，实时同步最新配置，避免 React state 缓存导致的与文件不一致问题
  useEffect(() => {
    if (harness) {
      if (harness.model?.temperature !== undefined) {
        setTemperature(harness.model.temperature);
      }
      if (harness.model?.max_tokens !== undefined) {
        setMaxTokens(harness.model.max_tokens);
      }
      if (harness.systemPrompt !== undefined) {
        setSystemPrompt(harness.systemPrompt);
      }
    }
  }, [harness]);

  // Keep stable refs to harness and onHarnessUpdate so the debounce effect can
  // read the latest values without adding them to the dependency array
  // (which would cause the effect to fire on every harness prop update)
  const harnessRef = useRef(harness);
  const onHarnessUpdateRef = useRef(onHarnessUpdate);
  useEffect(() => { harnessRef.current = harness; });
  useEffect(() => { onHarnessUpdateRef.current = onHarnessUpdate; });

  // 防抖自动保存本地修改的参数到后端配置文件中
  // Uses harnessRef/onHarnessUpdateRef to read latest values without triggering re-runs
  useEffect(() => {
    const harness = harnessRef.current;
    if (!harness) return;

    const hasChanges = 
      maxTokens !== harness.model?.max_tokens ||
      temperature !== harness.model?.temperature ||
      systemPrompt !== harness.systemPrompt;

    if (!hasChanges) return;

    const timer = setTimeout(() => {
      const h = harnessRef.current;
      if (!h) return;
      const updatedHarness = {
        ...h,
        model: {
          ...h.model,
          max_tokens: maxTokens,
          temperature: temperature
        },
        systemPrompt: systemPrompt
      };

      fetch(`http://localhost:3001/api/harnesses/${h.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedHarness)
      })
      .then(res => {
        if (res.ok && onHarnessUpdateRef.current) {
          onHarnessUpdateRef.current(updatedHarness);
          console.log(`💾 自动保存配置到 ${h.id}.json 成功`);
        }
      })
      .catch(err => console.error("自动保存 harness 配置失败:", err));
    }, 1000); // 1秒防抖，防止拖拽 range 或是连续输入时频繁写盘

    return () => clearTimeout(timer);
  }, [maxTokens, temperature, systemPrompt]); // intentionally omit harness/onHarnessUpdate - read via refs

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
        handleRetryTurn={agentState.handleRetryTurn}
        loopCount={agentState.loopCount}
      />

      {/* 上下文检查器模态框 */}
      {showContextInspector && (
        <ContextInspector
          messages={agentState.messages}
          todos={agentState.todos}
          systemPrompt={systemPrompt}
          tools={harness.tools}
          skills={harness.skills || []}
          availableSkills={allSkills}
          setShowContextInspector={setShowContextInspector}
          thinkingEnabled={thinkingEnabled}
          compactionEnabled={harness.features?.context_compaction !== false}
          currentTokens={agentState.currentTokens}
          modelConfig={selectedModel}
        />
      )}
    </div>
  );
}
