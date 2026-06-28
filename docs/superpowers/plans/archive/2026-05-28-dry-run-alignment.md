# 后端 Dry Run 接口对接实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Context Inspector 模态框，使其通过请求后端 `/api/harnesses/:harnessId/dry-run` 接口异步获取对齐数据，代替原有的前端同步计算。

**Architecture:** 
1. 在 `ContextInspector.jsx` 中添加 `loading`、`error`、`alignedData` 状态，并使用 `useEffect` 监听 harness 信息与 message/todo/tools 等的变化，向后端发送 Dry Run 异步请求。
2. 在 `TrajectoryPage.jsx` 实例化 `<ContextInspector />` 时传入 `harness` prop。
3. 替换 `ContextInspector` 原有的同步计算逻辑，将所有渲染的数据源替换为 `alignedData`。如果在加载中，显示加载动效；如果出错，显示错误提示。

**Tech Stack:** React, Fetch API, Tailwind CSS/Vanilla CSS

---

### Task 1: 重构 ContextInspector 组件

**Files:**
- Modify: `src/components/ContextInspector.jsx`

- [ ] **Step 1: 引入 React 状态与副作用钩子，定义 loading、error 及 alignedData 状态**
  - 修改 `src/components/ContextInspector.jsx`，从 `'react'` 中导入 `useState` 和 `useEffect`。
  - 接收新 prop `harness`。
  - 在组件内定义：
    ```javascript
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [alignedData, setAlignedData] = useState({ system: '', tools: [], messages: [] });
    ```

- [ ] **Step 2: 编写 useEffect 异步加载数据逻辑**
  - 监听 `harness?.id`, `messages`, `todos`, `systemPrompt`, `tools`, `skills`, `availableSkills`, `modelConfig`, `thinkingEnabled`。
  - 当依赖项变更时，重置 `loading` 为 `true`，`error` 为 `null`。
  - 构造 `toolSchemas` 和 `richSkills`，然后 fetch `http://localhost:3001/api/harnesses/${harness.id}/dry-run`：
    ```javascript
    useEffect(() => {
      if (!harness?.id) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);

      const toolSchemas = (tools || []).map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema || {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(t.parameters || {}).map(([k, v]) => [k, { type: v.type || 'string', description: v.description || '' }])
          ),
          required: Object.entries(t.parameters || {}).filter(([, v]) => v.required).map(([k]) => k),
        }
      }));

      const richSkills = skills.map(id => {
        const found = availableSkills.find(s => s.id === id);
        if (found) return found;
        return { id, file: `skills/${id}/SKILL.md`, description: 'Professional skill' };
      });

      fetch(`http://localhost:3001/api/harnesses/${harness.id}/dry-run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          todos,
          systemPrompt,
          tools: toolSchemas,
          features: harness.features || {},
          model: modelConfig,
          temperature: modelConfig?.temperature,
          maxTokens: modelConfig?.max_tokens,
          thinkingEnabled,
          skills: richSkills.map(s => s.id)
        })
      })
      .then(res => {
        if (!res.ok) {
          return res.json().then(data => {
            throw new Error(data.error || `HTTP error! status: ${res.status}`);
          });
        }
        return res.json();
      })
      .then(data => {
        setAlignedData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Dry Run Failed:", err);
        setError(err.message || '获取 Dry Run 数据失败');
        setLoading(false);
      });
    }, [
      harness?.id,
      messages,
      todos,
      systemPrompt,
      tools,
      skills,
      availableSkills,
      modelConfig,
      thinkingEnabled
    ]);
    ```

- [ ] **Step 3: 修改数据源为 alignedData 并更新 UI**
  - 去除原来本地同步生成的 `apiMessages`, `messagesWithTodos`, `toolSchemas` (组件级), `richSkills` (组件级) 和 `aligned`。
  - 使用 `alignedData` 定义 `fullContext`：
    ```javascript
    const fullContext = {
      system: alignedData.system || '(无)',
      tools: alignedData.tools || [],
      messages: alignedData.messages || [],
    };
    ```
  - 将 `aligned` 对象的使用替换为 `alignedData`，例如：
    - `aligned.system` -> `alignedData.system`
    - `aligned.tools` -> `alignedData.tools`
    - `aligned.messages` -> `alignedData.messages`
  - System Prompt 渲染区，标题由 `"⚙️ System Prompt"` 改为 `"⚙️ Assembled System Prompt (完整系统提示词)"`。
  - 可滚动内容区（Line 220 左右）的渲染逻辑重构：
    - 如果 `loading` 为真，展示高雅的加载动效占位。
    - 如果 `error` 不为空，展示红色的错误信息。
    - 否则才渲染：
      - `{renderSystemPrompt()}`
      - `{renderTools()}`
      - 分割线和 `Messages` 列表。
  - 复制 JSON 时，仍然复制 `fullContext` 即可。

---

### Task 2: 在 TrajectoryPage 中传递 harness 属性

**Files:**
- Modify: `src/pages/TrajectoryPage.jsx:254-268`

- [ ] **Step 1: 传递 harness 属性**
  - 找到 `<ContextInspector />` 的实例化位置，并增加 `harness={harness}`：
    ```jsx
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
    ```

---

### Task 3: 构建与验证

- [ ] **Step 1: 执行 build 验证**
  - 运行命令 `npm run build`
  - 预期输出：构建成功无语法及打包错误。
