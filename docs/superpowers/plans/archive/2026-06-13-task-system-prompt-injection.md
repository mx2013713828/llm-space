# 任务系统提示词一键注入与客制化 (task_manager) 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现任务看板与 DAG 任务系统提示词的运行时自动装配、去重，并在前端工作台支持高级客制化文本框（含显式保存和一键 Reset 缓冲区）。

**Architecture:** 在 FeatureSchema 中追加两个 text_area 二级子特性存储默认英文 XML 引导词；后端插件（TodoNag/TaskSystem）在 preLLM 阶段根据标签做幂等性校验，动态混入 context.systemPrompt ；前端使用局部 state 做输入 Buffer，配置显式 Save 和 Reset 按钮以控制落盘时机。

---

### Task 1: 改造 FeatureSchema.js 数据模型

**Files:**
- Modify: `src/lib/FeatureSchema.js`
- Test: `scratch/test-feature-schema.js` (NEW)

- [ ] **Step 1: 新建自检测试脚本**
  创建 `scratch/test-feature-schema.js` 用来检测 Schema 属性是否定义正确。
  ```javascript
  import { FeatureSchema } from '../src/lib/FeatureSchema.js';

  const taskManager = FeatureSchema.task_manager;
  console.assert(taskManager !== undefined, 'task_manager 特性不存在');
  console.assert(taskManager.children.todo_prompt !== undefined, 'todo_prompt 属性未定义');
  console.assert(taskManager.children.task_system_prompt !== undefined, 'task_system_prompt 属性未定义');
  console.assert(taskManager.children.todo_prompt.type === 'text_area', 'todo_prompt 类型应为 text_area');

  console.log('✅ FeatureSchema task_manager 字段自检通过');
  ```

- [ ] **Step 2: 运行自检测试并确认失败**
  运行：`node scratch/test-feature-schema.js`
  预期：失败，报错 `todo_prompt 属性未定义`。

- [ ] **Step 3: 修改 `src/lib/FeatureSchema.js`**
  定位到 `task_manager.children.mode` 的声明后，追加 `todo_prompt` 与 `task_system_prompt` 定义。
  修改如下：
  ```javascript
  // 在 src/lib/FeatureSchema.js 中定位到 task_manager:
    task_manager: {
      type: 'group',
      label: '任务看板与进度管理系统',
      description: '配置 Agent 任务规划与催促流转机制（开启后会自动停用/屏蔽底层原子工具，由实验特性一键搭载）。',
      defaultValue: true,
      failSafeValue: true,
      children: {
        mode: {
          type: 'select',
          label: '看板运行模式',
          description: '选择看板运行的引擎和依赖机制。',
          defaultValue: 'todo',
          failSafeValue: 'todo',
          options: [
            { value: 'todo', label: 'Write-Todo 线性看板 (经典版)' },
            { value: 'task_system', label: 'Task-System 拓扑依赖系统 (DAG版)' }
          ]
        },
        todo_prompt: {
          type: 'text_area',
          label: 'Todo 模式系统指引词 (XML 格式)',
          description: '当大模型使用线性看板时，实时注入 System Prompt 的行为规范指南。',
          defaultValue: `<todo_mode_guidelines>
  You must use the \`write_todos\` tool to manage your development board to keep your progress synchronized with the user:
  1. Upon receiving a complex request, immediately call \`write_todos\` to break down the task into 4-8 pending sub-tasks.
  2. Each time you complete a sub-task, call \`write_todos\` to mark its status as "completed".
  3. Ensure your task board status aligns with your actual implementation progress. Never write code for multiple turns without updating the task board.
  </todo_mode_guidelines>`,
          failSafeValue: ''
        },
        task_system_prompt: {
          type: 'text_area',
          label: 'Task System 模式系统指引词 (XML 格式)',
          description: '当大模型使用 DAG 任务系统时，实时注入 System Prompt 的行为规范指南。',
          defaultValue: `<task_system_guidelines>
  When facing complex development tasks, you must use the task dependency system to organize your workflow:
  1. First, analyze the requirements and create a dependency tree of Tasks using \`create_task\`. Declare upstream dependencies using \`blockedBy\` (comma-separated IDs).
  2. Call \`list_tasks\` to inspect the status of all current tasks.
  3. Before writing any code, call \`claim_task\` to claim a pending task that is not blocked by any uncompleted upstream dependencies.
  4. Once claimed successfully, use \`bash\`, \`read_file\`, and \`write_file\` to implement, debug, and verify the task.
  5. Upon completion, call \`complete_task\` to mark it as "completed", which will automatically unlock downstream dependent tasks.
  6. Do not write code for multiple consecutive turns without updating the task board status.
  </task_system_guidelines>`,
          failSafeValue: ''
        }
      }
    },
  ```

- [ ] **Step 4: 运行自检测试确认通过**
  运行：`node scratch/test-feature-schema.js`
  预期：输出 `✅ FeatureSchema task_manager 字段自检通过`。

- [ ] **Step 5: 提交更改**
  ```bash
  git add src/lib/FeatureSchema.js scratch/test-feature-schema.js
  git commit -m "feat: extend FeatureSchema to support todo_prompt and task_system_prompt textarea sub-features"
  ```

---

### Task 2: 重构后端生命周期插件实时注入与去重

**Files:**
- Modify: `server/agent/plugins/TodoNagPlugin.js`
- Modify: `server/agent/plugins/TaskSystemPlugin.js`
- Test: `node scratch/test-task-manager.js`

- [ ] **Step 1: 重构 `TodoNagPlugin.js`**
  定位到 `server/agent/plugins/TodoNagPlugin.js` 的 `preLLM` 方法：
  ```javascript
  // 替换前：
  async preLLM(context) {
    // 调用现有的注入逻辑，将 current_tasks_status 附加到 apiMessages 末尾
    context.apiMessages = injectTodoState(
      context.apiMessages, 
      context.executor.todos, 
      context.executor.roundsSinceTodo
    );
  },

  // 替换后：
  async preLLM(context) {
    const { executor } = context;
    // 动态提取并实时装配 todo_prompt (带 XML 去重判定)
    const customPrompt = executor.features.task_manager?.todo_prompt;
    const defaultSchema = executor.features.task_manager?.todo_prompt !== undefined ? '' : null; 
    // 若配置未定义，则回退读取默认值：
    let promptToInject = customPrompt;
    if (promptToInject === undefined || promptToInject === null) {
      // 动态读取 Schema 默认值
      const { FeatureSchema } = await import('../../../src/lib/FeatureSchema.js');
      promptToInject = FeatureSchema.task_manager?.children?.todo_prompt?.defaultValue || '';
    }

    if (promptToInject && !context.systemPrompt.includes('<todo_mode_guidelines>')) {
      context.systemPrompt += `\n${promptToInject}\n`;
    }

    // 调用现有的注入逻辑，将 current_tasks_status 附加到 apiMessages 末尾
    context.apiMessages = injectTodoState(
      context.apiMessages, 
      context.executor.todos, 
      context.executor.roundsSinceTodo
    );
  },
  ```

- [ ] **Step 2: 重构 `TaskSystemPlugin.js`**
  定位到 `server/agent/plugins/TaskSystemPlugin.js` 的 `preLLM` 方法（约第 5 行到第 50 行）：
  ```javascript
  // 替换前：
  async preLLM(context) {
    const { executor, apiMessages, turnIndex } = context;
    const harnessId = executor.harnessId || 'default';

    // 1. 加载磁盘上该 Harness 下的所有任务
    const tasks = await taskManager.loadTasks(harnessId);
    if (tasks.length === 0) return;

    // 2. 静态结构注入：注入静态任务树依赖结构到 System Prompt (前缀缓存友好原则)
    const taskGraph = tasks.map(t => {
      const deps = t.blockedBy.length > 0 ? ` blockedBy [${t.blockedBy.join(', ')}]` : '';
      return `- ${t.id}: [${t.subject}]${deps}`;
    }).join('\n');

    const staticSection = `\n<task_dependency_graph>\n${taskGraph}\n</task_dependency_graph>\n`;
    
    // 如果系统提示词中尚未注入，则追加到 System 末尾锁定缓存前缀
    if (!context.systemPrompt.includes('<task_dependency_graph>')) {
      context.systemPrompt += staticSection;
    }
    ...

  // 替换后：
  async preLLM(context) {
    const { executor, apiMessages, turnIndex } = context;
    const harnessId = executor.harnessId || 'default';

    // 注入自定义的 task_system_prompt (带 XML 去重)
    const customPrompt = executor.features.task_manager?.task_system_prompt;
    let promptToInject = customPrompt;
    if (promptToInject === undefined || promptToInject === null) {
      const { FeatureSchema } = await import('../../../src/lib/FeatureSchema.js');
      promptToInject = FeatureSchema.task_manager?.children?.task_system_prompt?.defaultValue || '';
    }

    if (promptToInject && !context.systemPrompt.includes('<task_system_guidelines>')) {
      context.systemPrompt += `\n${promptToInject}\n`;
    }

    // 1. 加载磁盘上该 Harness 下的所有任务
    const tasks = await taskManager.loadTasks(harnessId);
    if (tasks.length === 0) return;

    // 2. 静态结构注入：注入静态任务树依赖结构到 System Prompt (前缀缓存友好原则)
    const taskGraph = tasks.map(t => {
      const deps = t.blockedBy.length > 0 ? ` blockedBy [${t.blockedBy.join(', ')}]` : '';
      return `- ${t.id}: [${t.subject}]${deps}`;
    }).join('\n');

    const staticSection = `\n<task_dependency_graph>\n${taskGraph}\n</task_dependency_graph>\n`;
    
    // 如果系统提示词中尚未注入，则追加到 System 末尾锁定缓存前缀
    if (!context.systemPrompt.includes('<task_dependency_graph>')) {
      context.systemPrompt += staticSection;
    }
    ...
  ```

- [ ] **Step 3: 运行自检测试并验证**
  运行：`node scratch/test-task-manager.js`
  预期：`✅ taskManager Kahn 拓扑算法测试通过`

- [ ] **Step 4: 提交更改**
  ```bash
  git add server/agent/plugins/TodoNagPlugin.js server/agent/plugins/TaskSystemPlugin.js
  git commit -m "feat: inject custom XML guidelines in preLLM lifecycles for TodoNag and TaskSystem plugins"
  ```

---

### Task 3: 前端 UI 渲染与高级编辑保存控制

**Files:**
- Modify: `src/pages/PromptLabPage.jsx`

- [ ] **Step 1: 新建局部 state 和组件引用**
  在 `src/pages/PromptLabPage.jsx` 中：
  引入 `localPrompt` 与保存成功视觉反馈相关的 state。
  定位到 `PromptLabPage` 的状态定义头部（约第 20 行）：
  ```javascript
  // 增加：
  const [localPrompt, setLocalPrompt] = useState('');
  const [isSavedFeedback, setIsSavedFeedback] = useState(false);
  ```

- [ ] **Step 2: 条件数据绑定与重刷逻辑**
  使用 `useEffect` 监听当前 `harness` 切换以及 `features` 的变化，来刷新 `localPrompt` 局部缓冲：
  ```javascript
  useEffect(() => {
    const isTaskManagerEnabled = features.task_manager?.enabled !== false;
    const currentMode = features.task_manager?.mode || 'todo';
    const subKey = currentMode === 'todo' ? 'todo_prompt' : 'task_system_prompt';
    
    // 载入当前模式下的默认或客制化 prompt
    const initialVal = features.task_manager?.[subKey] ?? '';
    setLocalPrompt(initialVal);
  }, [harness.id, features.task_manager?.mode, features.task_manager?.todo_prompt, features.task_manager?.task_system_prompt]);
  ```

- [ ] **Step 3: 在 `PromptLabPage.jsx` 二级配置中支持 `'text_area'` 类型渲染**
  定位到 `subMeta.type === 'select'` 的渲染块下方：
  ```javascript
  // 替换前：
  const isSubEnabled = isParentEnabled && !!features[key]?.[subKey];
  return (
    <label key={subKey} ...
  
  // 替换后：
  if (subMeta.type === 'text_area') {
    // 依据当前的 mode 决定是否隐藏当前不匹配的文本框
    const currentMode = features[key]?.mode || 'todo';
    const expectedSubKey = currentMode === 'todo' ? 'todo_prompt' : 'task_system_prompt';
    if (subKey !== expectedSubKey) return null;

    const isExpanded = localPrompt !== undefined; // 始终可见或通过面板折叠
    const defaultValue = subMeta.defaultValue;

    return (
      <div key={subKey} style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4, width: '100%' }}>
        <details style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-elevated)' }}>
          <summary style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer', userSelect: 'none' }}>
            ⚙️ 自定义任务流系统指引词 (XML 英文规范)...
          </summary>
          <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{subMeta.description}</div>
            <textarea
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              disabled={!isParentEnabled}
              style={{
                width: '100%',
                height: 180,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                padding: '8px 10px',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                resize: 'vertical'
              }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={!isParentEnabled}
                onClick={() => setLocalPrompt(defaultValue)}
                className="btn-secondary"
                style={{ fontSize: 11, padding: '4px 10px', height: 26 }}
              >
                🔄 恢复默认
              </button>
              <button
                type="button"
                disabled={!isParentEnabled}
                onClick={() => {
                  handleSubFeatureChange(key, subKey, localPrompt);
                  setIsSavedFeedback(true);
                  setTimeout(() => setIsSavedFeedback(false), 2000);
                }}
                className="btn-primary"
                style={{ fontSize: 11, padding: '4px 12px', height: 26, background: isSavedFeedback ? 'var(--green)' : 'var(--blue)' }}
              >
                {isSavedFeedback ? '✅ 已保存' : '💾 保存 Prompt'}
              </button>
            </div>
          </div>
        </details>
      </div>
    );
  }

  const isSubEnabled = isParentEnabled && !!features[key]?.[subKey];
  return (
    <label key={subKey} ...
  ```

- [ ] **Step 4: 测试编译错误**
  运行：`npm run lint` 检查 PromptLabPage.jsx 是否含有编译错误。

- [ ] **Step 5: 提交更改**
  ```bash
  git add src/pages/PromptLabPage.jsx
  git commit -m "feat: implement rich textarea customizer with local Buffer, save, and reset buttons in PromptLabPage"
  ```
