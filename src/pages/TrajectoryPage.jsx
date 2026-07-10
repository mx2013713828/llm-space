import { useState, useEffect, useRef } from 'react';
import { useModels } from '../hooks/useModels';
import { useAgentLoop } from '../hooks/useAgentLoop';
import { useAutoScroll } from '../hooks/useAutoScroll';

import { ConfigPanel } from '../components/ConfigPanel';
import { TrajectoryView } from '../components/TrajectoryView';
import { ContextInspector } from '../components/ContextInspector';
import { apiFetch } from '../lib/apiClient';

export function TrajectoryPage({ harness, savedSession, onSessionUpdate, onSessionReset, onHarnessUpdate }) {
  // 1. 模型管理 Hook
  const {
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
    handleUpdateModel
  } = useModels();

  // 2. 本地配置状态
  const [temperature, setTemperature] = useState(harness.model?.temperature || 1.0);
  const [maxTokens, setMaxTokens] = useState(harness.model?.max_tokens || 8000);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [systemPrompt, setSystemPrompt] = useState(harness.systemPrompt);
  const [isPromptDirty, setIsPromptDirty] = useState(false);
  const guidanceFile = harness.guidance?.file || (harness.id ? `guidance/${harness.id}/AGENTS.md` : 'guidance/<harness>/AGENTS.md');

  const [allSkills, setAllSkills] = useState([]);
  useEffect(() => {
    // enable_skills 现在是 group 类型，从 .enabled 读父开关；向后兼容旧的 boolean 格式
    const skillsEnabled = harness?.features?.enable_skills?.enabled
      ?? (harness?.features?.enable_skills !== false); // 旧格式兼容
    if (!skillsEnabled) {
      setAllSkills([]);
      return;
    }
    // enable_global_skills 已移入 enable_skills.children，向后兼容旧扁平格式
    const isGlobal = harness?.features?.enable_skills?.enable_global_skills
      ?? harness?.features?.enable_global_skills
      ?? true;
    apiFetch(`/api/skills?global=${isGlobal}`)
      .then(r => r.json())
      .then(data => setAllSkills(data))
      .catch(console.error);
  }, [harness]);


  const lastHarnessIdRef = useRef(harness?.id);
  const isFirstMountRef = useRef(true);

  // 监听 harness 的变化，实时同步最新配置，同时利用 isPromptDirty 状态进行数据防覆盖守卫
  useEffect(() => {
    if (harness) {
      const isSwitching = lastHarnessIdRef.current !== harness.id;
      lastHarnessIdRef.current = harness.id;

      if (harness.model?.temperature !== undefined) {
        setTemperature(harness.model.temperature);
      }
      if (harness.model?.max_tokens !== undefined) {
        setMaxTokens(harness.model.max_tokens);
      }

      // 如果用户切换了 Harness 资源，则无条件同步并重置脏状态；
      // 如果没有切换（仅更新内部参数），则只有在本地没有未保存改动的情况下才载入外部 Prompt，防止草稿被意外覆盖
      if (isSwitching) {
        setSystemPrompt(harness.systemPrompt || '');
        setIsPromptDirty(false);
        isFirstMountRef.current = true;
      } else if (!isPromptDirty && harness.systemPrompt !== undefined) {
        setSystemPrompt(harness.systemPrompt);
      }
    }
  }, [harness, isPromptDirty]);

  const handlePromptChange = (val) => {
    setSystemPrompt(val);
    setIsPromptDirty(true);
  };

  const handleSavePrompt = () => {
    const updatedHarness = {
      ...harness,
      model: {
        ...harness.model,
        max_tokens: maxTokens,
        temperature: temperature
      },
      systemPrompt: systemPrompt
    };

    apiFetch(`/api/harnesses/${harness.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedHarness)
    })
    .then(res => {
      if (res.ok) {
        if (onHarnessUpdate) {
          onHarnessUpdate(updatedHarness);
        }
        setIsPromptDirty(false);
        alert('AGENTS.md saved successfully ✓');
      } else {
        alert('Failed to save AGENTS.md ❌');
      }
    })
    .catch(err => {
      console.error("Failed to save harness configuration:", err);
      alert('Failed to save AGENTS.md ❌');
    });
  };

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isPromptDirty) {
        e.preventDefault();
        e.returnValue = 'You have unsaved system prompt changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isPromptDirty]);

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

    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }

    const hasChanges = 
      Number(maxTokens) !== Number(harness.model?.max_tokens) ||
      Number(temperature) !== Number(harness.model?.temperature);

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
        systemPrompt: h.systemPrompt
      };

      apiFetch(`/api/harnesses/${h.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedHarness)
      })
      .then(res => {
        if (res.ok) {
          if (onHarnessUpdateRef.current) {
            onHarnessUpdateRef.current(updatedHarness);
          }
          console.log(`💾 Automatically saved model parameters (maxTokens/temp) to ${h.id}.json successfully`);
        } else {
          console.error(`Failed to automatically save model parameters, HTTP status code: ${res.status}`);
        }
      })
      .catch(err => console.error("Failed to automatically save parameters:", err));
    }, 1000); // 1s debounce to prevent frequent writes when dragging range or typing continuously

    return () => clearTimeout(timer);
  }, [maxTokens, temperature]); // intentionally omit harness/onHarnessUpdate - read via refs

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
        harness={harness}
        models={models}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        showAddModel={showAddModel}
        setShowAddModel={setShowAddModel}
        showEditModel={showEditModel}
        setShowEditModel={setShowEditModel}
        newModelConfig={newModelConfig}
        setNewModelConfig={setNewModelConfig}
        editModelConfig={editModelConfig}
        setEditModelConfig={setEditModelConfig}
        handleAddModel={handleAddModel}
        handleUpdateModel={handleUpdateModel}
        
        temperature={temperature}
        setTemperature={setTemperature}
        maxTokens={maxTokens}
        setMaxTokens={setMaxTokens}
        thinkingEnabled={thinkingEnabled}
        setThinkingEnabled={setThinkingEnabled}
        
        systemPrompt={systemPrompt}
        guidanceFile={guidanceFile}
        isPromptDirty={isPromptDirty}
        onPromptChange={handlePromptChange}
        onSavePrompt={handleSavePrompt}
      />

      {/* 右侧轨迹视图 */}
      <TrajectoryView
        activeRightTab={activeRightTab}
        setActiveRightTab={setActiveRightTab}
        harness={harness}
        messages={agentState.messages}
        todos={agentState.todos}
        backgroundTasks={agentState.backgroundTasks}
        turns={agentState.turns}
        isRunning={agentState.isRunning}
        currentTokens={agentState.currentTokens}
        selectedModel={selectedModel}
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
        pendingPermission={agentState.pendingPermission}
        handlePermissionDecision={agentState.handlePermissionDecision}
      />

      {/* 上下文检查器模态框 */}
      {showContextInspector && (
        <ContextInspector
          harness={harness}
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
