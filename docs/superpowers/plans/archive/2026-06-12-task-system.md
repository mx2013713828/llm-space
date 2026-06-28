# Task System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 LLM Space 引入持久化、防死锁、高并发文件锁保护以及 Prompt Cache 缓存对齐的 DAG 任务依赖系统特性，并升级前端 TODO 看板实时渲染出依赖拓扑关系。

**Architecture:** 
1. 新建 `taskManager.js` 通过 Kahn 拓扑排序算法在 `create_task` 时做循环依赖检测，并在 `claim_task` 中使用排他文件锁（.lock）进行并发竞争防范。
2. 封装 `TaskSystemPlugin.js`（生命周期插件），在 `preLLM` 将任务拓扑（静态）和任务状态差分（动态）进行静前动后式拼装，保护前缀缓存；在 `preToolUse` 拦截 5 个任务工具逻辑，操作成功后广播最新的任务数组并下发 `task_update` SSE 事件流。
3. 升级前端 `TodoList.jsx` 以兼容渲染任务的 `blockedBy` 依赖链路与 `Owner` 分配。

**Tech Stack:** Node.js, Express, React, GFM, Kahn 拓扑排序算法

---

## 🛠️ 文件结构设计

- **新建文件**：
  - `server/agent/utils/taskManager.js`：后端任务物理读写、Kahn 算法检测环、claim 写入锁。
  - `server/agent/plugins/TaskSystemPlugin.js`：ReAct 循环 Hook 拦截，注入静态索引与动态状态 Diff，捕获异常将被中断任务回退。
  - `server/tools/create_task.js`：创建任务工具。
  - `server/tools/list_tasks.js`：列出任务工具。
  - `server/tools/get_task.js`：获取单个任务详情工具。
  - `server/tools/claim_task.js`：认领任务工具。
  - `server/tools/complete_task.js`：完成任务工具。
  - `harnesses/05-task-system.json`：新的测试 Harness。
- **修改文件**：
  - `server/tools/index.js`：导出 5 个新工具。
  - `server.js`：在 DELETE `/api/sessions/:harnessId` 路由中清除该 Harness 任务目录。
  - `src/components/TodoList.jsx`：适配 Task 数据，渲染依赖拓扑和 Owner 徽章。

---

## 📅 实施步骤细化

### Task 1: 新建后端任务管理器 (Task Manager)

**Files:**
- Create: `server/agent/utils/taskManager.js`

- [ ] **Step 1: 创建文件并实现 Kahn 算法及并发文件锁**
  写入任务文件读写、并发锁及环路拓扑检测逻辑：

```javascript
// server/agent/utils/taskManager.js
import fs from 'fs/promises';
import path from 'path';

function getTaskDir(harnessId) {
  return path.join(process.cwd(), 'server', 'sessions', `${harnessId}_tasks`);
}

export async function clearTasks(harnessId) {
  const dir = getTaskDir(harnessId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function loadTasks(harnessId) {
  const dir = getTaskDir(harnessId);
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const tasks = [];
    for (const file of files) {
      if (file.endsWith('.json') && !file.endsWith('.lock.json')) {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        tasks.push(JSON.parse(content));
      }
    }
    return tasks;
  } catch (e) {
    return [];
  }
}

export async function saveTask(harnessId, task) {
  const dir = getTaskDir(harnessId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${task.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');
}

export async function getTask(harnessId, taskId) {
  const dir = getTaskDir(harnessId);
  const filePath = path.join(dir, `${taskId}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

export async function canStart(harnessId, taskId) {
  try {
    const tasks = await loadTasks(harnessId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;
    for (const depId of task.blockedBy) {
      const depTask = tasks.find(t => t.id === depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function hasCycle(tasks) {
  const adj = new Map();
  const inDegree = new Map();

  tasks.forEach(t => {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  });

  tasks.forEach(t => {
    (t.blockedBy || []).forEach(upstreamId => {
      if (adj.has(upstreamId)) {
        adj.get(upstreamId).push(t.id);
        inDegree.set(t.id, inDegree.get(t.id) + 1);
      }
    });
  });

  const queue = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });

  let visitedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift();
    visitedCount++;
    (adj.get(u) || []).forEach(v => {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    });
  }

  return visitedCount !== tasks.length;
}

export async function claimTaskWithLock(harnessId, taskId, ownerId) {
  const dir = getTaskDir(harnessId);
  const lockPath = path.join(dir, `${taskId}.lock`);
  let lockHandle;
  try {
    lockHandle = await fs.open(lockPath, 'wx');
    
    const tasks = await loadTasks(harnessId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (task.status !== 'pending') throw new Error(`任务 ${taskId} 当前状态为 ${task.status}，无法认领`);
    
    const checkStart = await canStart(harnessId, taskId);
    if (!checkStart) {
      const pendingDeps = [];
      for (const depId of task.blockedBy) {
        const depTask = tasks.find(t => t.id === depId);
        if (!depTask || depTask.status !== 'completed') {
          pendingDeps.push(depId);
        }
      }
      throw new Error(`已被上游依赖阻塞: [${pendingDeps.join(', ')}]`);
    }

    task.status = 'in_progress';
    task.owner = ownerId;
    await saveTask(harnessId, task);
    return `成功认领任务: ${task.subject}`;
  } finally {
    if (lockHandle) {
      await lockHandle.close();
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}
```

- [ ] **Step 2: 编写测试脚本验证 `taskManager.js` 的环路检测与文件操作**
  在 scratch 下创建测试代码并运行。
  测试脚本代码：
  ```javascript
  // scratch/test-task-manager.js
  import { hasCycle } from '../server/agent/utils/taskManager.js';
  
  const okTasks = [
    { id: '1', blockedBy: [] },
    { id: '2', blockedBy: ['1'] }
  ];
  const cycleTasks = [
    { id: '1', blockedBy: ['2'] },
    { id: '2', blockedBy: ['1'] }
  ];
  
  console.assert(hasCycle(okTasks) === false, 'DAG 无环判定失败');
  console.assert(hasCycle(cycleTasks) === true, '循环依赖环路判定失败');
  console.log('✅ taskManager Kahn 拓扑算法测试通过');
  ```
  执行命令: `node scratch/test-task-manager.js`
  预期输出: `✅ taskManager Kahn 拓扑算法测试通过`

- [ ] **Step 3: 提交代码**

```bash
git add server/agent/utils/taskManager.js
git commit -m "feat: add taskManager with atomic lock and Kahn cycle detection"
```

---

### Task 2: 编写 5 个原子任务工具与注册

**Files:**
- Create: `server/tools/create_task.js`
- Create: `server/tools/list_tasks.js`
- Create: `server/tools/get_task.js`
- Create: `server/tools/claim_task.js`
- Create: `server/tools/complete_task.js`
- Modify: `server/tools/index.js`

- [ ] **Step 1: 新建 `create_task.js`**
  写入创建任务 Schema 定义：

```javascript
// server/tools/create_task.js
export default {
  name: 'create_task',
  description: '创建一个全新的任务。系统会自动利用 Kahn 拓扑排序算法校验是否存在环路，防止循环依赖导致的任务死锁。',
  parameters: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: '任务标题 (例: "设计表结构")' },
      description: { type: 'string', description: '详细的任务上下文及背景说明' },
      blockedBy: {
        type: 'array',
        items: { type: 'string' },
        description: '该任务依赖的上游任务 ID 列表 (例如: ["task_17180001_ab12"])'
      }
    },
    required: ['subject']
  },
  async execute() {
    // 逻辑将被 TaskSystemPlugin 插件生命周期拦截接管，此处提供空返回
    return '[create_task 拦截启动]';
  }
};
```

- [ ] **Step 2: 新建 `list_tasks.js`**

```javascript
// server/tools/list_tasks.js
export default {
  name: 'list_tasks',
  description: '列出当前会话下的所有任务及其完成状态、所属 Owner 和依赖情况，供大模型分析当前看板状态。',
  parameters: { type: 'object', properties: {} },
  async execute() {
    return '[list_tasks 拦截启动]';
  }
};
```

- [ ] **Step 3: 新建 `get_task.js`**

```javascript
// server/tools/get_task.js
export default {
  name: 'get_task',
  description: '查询单个任务的完整详细属性 (包括详细描述及完整的依赖列表)。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '任务 ID' }
    },
    required: ['id']
  },
  async execute() {
    return '[get_task 拦截启动]';
  }
};
```

- [ ] **Step 4: 新建 `claim_task.js`**

```javascript
// server/tools/claim_task.js
export default {
  name: 'claim_task',
  description: '认领一个处于待开始状态的任务。只有当其依赖的所有上游任务均处于 completed 状态时，认领才能成功。系统自动对其施加并发锁。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '待认领任务的唯一 ID' }
    },
    required: ['id']
  },
  async execute() {
    return '[claim_task 拦截启动]';
  }
};
```

- [ ] **Step 5: 新建 `complete_task.js`**

```javascript
// server/tools/complete_task.js
export default {
  name: 'complete_task',
  description: '将一个进行中的任务标记为已完成 (completed)。系统会自动解锁由于该任务完成而不再受阻的下游任务。',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '待完成任务的唯一 ID' }
    },
    required: ['id']
  },
  async execute() {
    return '[complete_task 拦截启动]';
  }
};
```

- [ ] **Step 6: 在 `server/tools/index.js` 中注册并导出工具**
  用 `replace_file_content` 修改 `server/tools/index.js`，引入这 5 个工具并注册：

```javascript
// 修改 server/tools/index.js 中的 imports 和 tools 数组，加上：
import create_task from './create_task.js';
import list_tasks from './list_tasks.js';
import get_task from './get_task.js';
import claim_task from './claim_task.js';
import complete_task from './complete_task.js';

// 并把它们加入 exports 中的 tools 列表中
```

- [ ] **Step 7: 提交代码**

```bash
git add server/tools/create_task.js server/tools/list_tasks.js server/tools/get_task.js server/tools/claim_task.js server/tools/complete_task.js server/tools/index.js
git commit -m "feat: implement 5 new atomic task tools and register them in index"
```

---

### Task 3: 封装生命周期插件 (TaskSystemPlugin)

**Files:**
- Create: `server/agent/plugins/TaskSystemPlugin.js`

- [ ] **Step 1: 创建 `TaskSystemPlugin.js` 插件类**
  插件需要拦截这五个工具，并进行“静前动后”的缓存对齐注入：

```javascript
// server/agent/plugins/TaskSystemPlugin.js
import * as taskManager from '../utils/taskManager.js';

export const TaskSystemPlugin = {
  name: 'TaskSystemPlugin',

  async preLLM(context) {
    const { executor, apiMessages, turnIndex } = context;
    const harnessId = executor.harnessId || 'default';

    // 1. 加载所有任务并分类
    const tasks = await taskManager.loadTasks(harnessId);
    if (tasks.length === 0) return;

    // 2. 静态结构注入：注入静态任务树结构
    // 放入 system prompt 末尾以锁定缓存前缀 (DEVELOPMENT_SPEC.md 缓存友好要求)
    const taskGraph = tasks.map(t => {
      const deps = t.blockedBy.length > 0 ? ` blockedBy [${t.blockedBy.join(', ')}]` : '';
      return `- ${t.id}: [${t.subject}]${deps}`;
    }).join('\n');

    const staticSection = `\n<task_dependency_graph>\n${taskGraph}\n</task_dependency_graph>\n`;
    
    // 如果系统提示词不包含此图，在最尾部追加以锁定静态缓存前缀
    if (!context.systemPrompt.includes('<task_dependency_graph>')) {
      context.systemPrompt += staticSection;
    }

    // 3. 动态状态 Diff 注入：仅将变化的当前状态附加到最后一轮 User 消息的末尾 (防止缓存前缀失效)
    const stateSummary = tasks.map(t => {
      const ownerStr = t.owner ? ` (owner: ${t.owner})` : '';
      return `${t.id}: ${t.status}${ownerStr}`;
    }).join('\n');

    const dynamicSection = `\n<current_task_state_diff>\n${stateSummary}\n</current_task_state_diff>\n`;

    // 催促警告注入 (如果在 roundsSinceTaskAction >= 3 且有未完成任务)
    let nagSection = '';
    const hasActiveTasks = tasks.some(t => t.status !== 'completed');
    const rounds = executor.roundsSinceTaskAction || 0;
    if (rounds >= 3 && hasActiveTasks) {
      nagSection = `\n<system_reminder>\n你已连续 3 轮未更新任务看板了。请在继续执行下一步前，务必使用 claim_task 或 complete_task 保持状态同步。\n</system_reminder>\n`;
    }

    const payloadBlock = {
      type: 'text',
      text: `${dynamicSection}${nagSection}`
    };

    // 拼入 apiMessages 的最后一条消息中
    const lastMsg = apiMessages[apiMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content.push(payloadBlock);
    } else {
      apiMessages.push({ role: 'user', content: [payloadBlock] });
    }
  },

  async preToolUse(context) {
    const { executor, tool } = context;
    const harnessId = executor.harnessId || 'default';
    const toolName = tool.toolName;
    const args = tool.toolInput || {};

    const isTaskTool = ['create_task', 'list_tasks', 'get_task', 'claim_task', 'complete_task'].includes(toolName);
    if (!isTaskTool) return;

    // 只要调用了写入工具，重置 rounds
    if (['create_task', 'claim_task', 'complete_task'].includes(toolName)) {
      executor.roundsSinceTaskAction = 0;
    }

    try {
      if (toolName === 'create_task') {
        const tasks = await taskManager.loadTasks(harnessId);
        const taskId = `task_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
        const newTask = {
          id: taskId,
          subject: args.subject,
          description: args.description || '',
          status: 'pending',
          owner: null,
          blockedBy: args.blockedBy || []
        };

        // Kahn 算法 DAG 环路阻断
        const tempTasks = [...tasks, newTask];
        if (taskManager.hasCycle(tempTasks)) {
          throw new Error(`[DAG Error] 无法创建任务 "${args.subject}"，因为所声明的依赖关系 blockedBy: [${args.blockedBy.join(', ')}] 会产生循环依赖(死锁)！`);
        }

        await taskManager.saveTask(harnessId, newTask);
        tool.toolOutput = `[系统] 成功创建任务: ${newTask.id} (${newTask.subject})`;
      } 
      
      else if (toolName === 'list_tasks') {
        const tasks = await taskManager.loadTasks(harnessId);
        if (tasks.length === 0) {
          tool.toolOutput = '当前看板无任务。请先使用 create_task 创建任务。';
        } else {
          tool.toolOutput = tasks.map(t => {
            const deps = t.blockedBy.length > 0 ? ` (依赖: ${t.blockedBy.join(', ')})` : '';
            const owner = t.owner ? ` - Owner: ${t.owner}` : '';
            return `- ${t.id}: ${t.subject} [${t.status}]${owner}${deps}`;
          }).join('\n');
        }
      } 
      
      else if (toolName === 'get_task') {
        const task = await taskManager.getTask(harnessId, args.id);
        tool.toolOutput = JSON.stringify(task, null, 2);
      } 
      
      else if (toolName === 'claim_task') {
        const resMsg = await taskManager.claimTaskWithLock(harnessId, args.id, 'agent');
        tool.toolOutput = `[系统] ${resMsg}`;
      } 
      
      else if (toolName === 'complete_task') {
        const tasks = await taskManager.loadTasks(harnessId);
        const task = tasks.find(t => t.id === args.id);
        if (!task) throw new Error(`未找到任务 ${args.id}`);
        
        task.status = 'completed';
        await taskManager.saveTask(harnessId, task);

        // 寻找被解锁的下游任务
        const unblocked = [];
        const updatedTasks = await taskManager.loadTasks(harnessId);
        for (const t of updatedTasks) {
          if (t.status === 'pending' && t.blockedBy.includes(args.id)) {
            const check = await taskManager.canStart(harnessId, t.id);
            if (check) {
              unblocked.push(`${t.id} (${t.subject})`);
            }
          }
        }

        let out = `[系统] 已标记任务 ${args.id} 为 completed。`;
        if (unblocked.length > 0) {
          out += `\n🎉 下游依赖任务已被成功解锁: ${unblocked.join(', ')}`;
        }
        tool.toolOutput = out;
      }

      // 获取最新状态广播前端
      const updatedTasks = await taskManager.loadTasks(harnessId);
      executor.todos = updatedTasks.map(t => ({
        id: t.id,
        content: t.subject,
        subject: t.subject,
        description: t.description,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy
      }));
      executor.onEvent('todo_update', { todos: executor.todos });
    } catch (e) {
      tool.toolOutput = `[工具拦截报错]\n${e.message}`;
    }

    tool.handled = true; // 拦截成功，不再调用空 execute
  },

  async onLoopEnd(context) {
    const { executor, hasUpdatedTodoThisTurn } = context;
    if (!executor) return;

    // 如果是异常捕获清理时，或发生 crash
    // 捕获 in_progress 异常回退释放锁 (Release Path 事务)
    if (context.error || context.stopReason === 'error' || context.stopReason === 'timeout') {
      const harnessId = executor.harnessId || 'default';
      const tasks = await taskManager.loadTasks(harnessId);
      for (const t of tasks) {
        if (t.status === 'in_progress' && t.owner === 'agent') {
          t.status = 'pending';
          t.owner = null;
          await taskManager.saveTask(harnessId, t);
          console.warn(`[TaskSystem Release Path] 捕获到 Agent 运行异常，已释放进行中任务并回滚为 pending: ${t.id}`);
        }
      }
      const updatedTasks = await taskManager.loadTasks(harnessId);
      executor.todos = updatedTasks.map(t => ({
        id: t.id,
        content: t.subject,
        subject: t.subject,
        description: t.description,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy
      }));
      executor.onEvent('todo_update', { todos: executor.todos });
      return;
    }

    if (hasUpdatedTodoThisTurn) {
      executor.roundsSinceTaskAction = 0;
    } else {
      executor.roundsSinceTaskAction = (executor.roundsSinceTaskAction || 0) + 1;
    }
  }
};
```

- [ ] **Step 2: 在 `AgentExecutor.js` 中按需挂载插件**
  用 `replace_file_content` 修改 `server/agent/AgentExecutor.js`。
  找到构造函数或插件挂载处，按搭载的工具列表动态引入 `TaskSystemPlugin`：
  
  ```javascript
  // 在 server/agent/AgentExecutor.js 头部导入插件
  import { TaskSystemPlugin } from './plugins/TaskSystemPlugin.js';
  
  // 在构造函数初始化 plugins 数组的地方，添加逻辑：
  // 如果当前搭载了 'create_task' 工具，则把 TaskSystemPlugin 挂载到 Hook 调度中
  if (this.tools.some(t => t === 'create_task' || t.name === 'create_task')) {
    this.hooks.register(TaskSystemPlugin);
  }
  ```

- [ ] **Step 3: 提交代码**

```bash
git add server/agent/plugins/TaskSystemPlugin.js server/agent/AgentExecutor.js
git commit -m "feat: implement TaskSystemPlugin with life-cycle hooks and SSE push"
```

---

### Task 4: 联动删除与 REST 兼容

**Files:**
- Modify: `server.js`

- [ ] **Step 1: 在 DELETE 接口中递归清理任务文件**
  用 `replace_file_content` 替换 `/api/sessions/:harnessId` 的 DELETE 路由：

```javascript
// server.js 中的 DELETE 路由
app.delete('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const sessionPath = path.join(SESSIONS_DIR, `${harnessId}.json`);
    await fs.unlink(sessionPath).catch(() => {}); // 允许文件不存在
    
    // 清空任务物理目录
    const tasksDir = path.join(SESSIONS_DIR, `${harnessId}_tasks`);
    await fs.rm(tasksDir, { recursive: true, force: true }).catch(() => {});
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

- [ ] **Step 2: 提交代码**

```bash
git add server.js
git commit -m "feat: clear tasks directory on session reset REST API"
```

---

### Task 5: 前端 UI 看板对齐与升级 (TodoList)

**Files:**
- Modify: `src/components/TodoList.jsx`

- [ ] **Step 1: 升级 React 组件以渲染依赖 DAG**
  用 `replace_file_content` 替换 `src/components/TodoList.jsx`，使其感知 `blockedBy` 依赖图及 `owner` 分配：

```javascript
// src/components/TodoList.jsx
export function TodoList({ todos }) {
  if (!todos || todos.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">📋</div>
        <div className="empty-state-title">暂无任务</div>
        <div className="empty-state-desc">当使用 create_task 工具时，任务 DAG 看板将显示在这里</div>
      </div>
    );
  }

  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  const total = todos.length;
  const progress = Math.round((completed / total) * 100);

  const STATUS_CONFIG = {
    completed:   { label: '完成', color: 'var(--green)',  bgColor: 'var(--green-dim)',  icon: '✓' },
    in_progress: { label: '执行中', color: 'var(--blue)', bgColor: 'var(--blue-dim)', icon: '▶' },
    pending:     { label: '待执行', color: 'var(--text-muted)', bgColor: 'var(--bg-elevated)', icon: '○' },
    failed:      { label: '失败', color: 'var(--red)',   bgColor: 'var(--red-dim)',   icon: '✗' },
    aborted:     { label: '已撤销', color: 'var(--red)',   bgColor: 'var(--red-dim)',   icon: '✗' }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 进度概览 */}
      <div style={{ padding: '12px 14px', background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>任务进度</span>
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--blue)' }}>
            {completed}/{total}
          </span>
        </div>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          <span style={{ color: 'var(--green)' }}>✓ {completed} 完成</span>
          {inProgress > 0 && <span style={{ color: 'var(--blue)' }}>▶ {inProgress} 执行中</span>}
          <span>{total - completed - inProgress} 待执行</span>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="todo-list">
        {todos.map((todo, idx) => {
          const statusCfg = STATUS_CONFIG[todo.status] || STATUS_CONFIG.pending;
          
          // 获取依赖任务的主题
          const dependencyNames = (todo.blockedBy || []).map(depId => {
            const match = todos.find(t => t.id === depId);
            return {
              id: depId,
              subject: match ? match.subject : depId,
              isCompleted: match ? match.status === 'completed' : false
            };
          });

          return (
            <div
              key={todo.id || idx}
              className={`todo-item ${todo.status}`}
              style={{ animationDelay: `${idx * 0.05}s`, display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch' }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div
                  className={`todo-check ${todo.status}`}
                  style={{ color: statusCfg.color, marginTop: 2 }}
                >
                  {todo.status === 'completed' && '✓'}
                  {todo.status === 'in_progress' && (
                    <span style={{ fontSize: 8, animation: 'spin 1.5s linear infinite', display: 'inline-block' }}>◐</span>
                  )}
                  {['failed', 'aborted'].includes(todo.status) && '✗'}
                  {todo.status === 'pending' && '○'}
                </div>

                <div className="todo-content" style={{ flex: 1, fontSize: 12, fontWeight: 500 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                    {todo.id}
                  </div>
                  {todo.subject || todo.content}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 99,
                    background: statusCfg.bgColor, color: statusCfg.color, fontWeight: 600
                  }}>
                    {statusCfg.label}
                  </span>
                  {todo.owner && (
                    <span style={{ fontSize: 9, color: 'var(--blue)', background: 'var(--blue-dim)', padding: '1px 4px', borderRadius: 2 }}>
                      👤 {todo.owner}
                    </span>
                  )}
                </div>
              </div>

              {/* 依赖树渲染 */}
              {dependencyNames.length > 0 && (
                <div style={{
                  marginLeft: 22, padding: '4px 8px', borderRadius: 4,
                  background: 'var(--bg-elevated)', border: '1px dashed var(--border)',
                  fontSize: 10, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center'
                }}>
                  <span style={{ color: 'var(--text-muted)' }}>🔒 依赖于:</span>
                  {dependencyNames.map(dep => (
                    <span
                      key={dep.id}
                      style={{
                        padding: '1px 4px', borderRadius: 2,
                        background: dep.isCompleted ? 'var(--green-dim)' : 'var(--border)',
                        color: dep.isCompleted ? 'var(--green)' : 'var(--text-secondary)',
                        textDecoration: dep.isCompleted ? 'line-through' : 'none'
                      }}
                      title={dep.id}
                    >
                      {dep.isCompleted ? '✓' : '🔒'} {dep.subject}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交代码**

```bash
git add src/components/TodoList.jsx
git commit -m "feat: upgrade TodoList component to support Task dependencies rendering"
```

---

### Task 6: 创建 05-task-system 预设及文档记录

**Files:**
- Create: `harnesses/05-task-system.json`
- Modify: `docs/memory/plan.md`
- Modify: `docs/memory/status.md`

- [ ] **Step 1: 新建 `05-task-system.json` 配置文件**
  搭载相关工具与 Strict DAG 看板配置：

```json
{
  "id": "05-task-system",
  "name": "05-task-system",
  "description": "基于 DAG 依赖的有向无环图持久化任务系统，支持并发锁、环路检测、前缀缓存对齐和崩溃自愈。",
  "systemPrompt": "你是一个拥有专业任务规划能力的 AI Agent 软件工程师。在面对用户提出的复杂长周期开发需求时（例如编写含有数据库 Schema、API 接口和单元测试的项目），你必须使用任务依赖系统来组织你的工作：\n\n1. 首先，分析项目需求，将开发路线拆解为具有先后依赖的 Task（使用 create_task 创建）。每个 Task 应当是职责明确的原子项。使用 blockedBy 声明它的上游依赖关系。\n2. 使用 list_tasks 检查当前所有任务的进展。\n3. 在开始具体的编程前，使用 claim_task 认领一个已被解除阻塞（即所有依赖的 blockedBy 任务都已 completed）的 pending 状态的任务。\n4. 认领成功后，使用 bash, read_file, write_file 来具体实现该任务的编码、调试工作。\n5. 任务完成后，使用 complete_task 将其置为 completed，这会自动解锁它的下游任务，允许你在接下来的循环中认领下一个。\n6. 严禁使用 bash 工具执行 cat, less, vi 等文件读写操作，必须直接使用专门的 read_file 和 write_file 工具。\n\n请严格按部就班，用你强大的任务系统攻克挑战！",
  "tools": [
    "create_task",
    "list_tasks",
    "get_task",
    "claim_task",
    "complete_task",
    "bash",
    "read_file",
    "write_file"
  ],
  "features": {
    "enable_strict_task_dag": true,
    "parallel_tool_execution": true,
    "error_recovery": {
      "http_retry": true,
      "max_tokens_escalation": true,
      "diminishing_returns": true
    }
  }
}
```

- [ ] **Step 2: 更新 `plan.md` 文档**
  在 `docs/memory/plan.md` 的末尾追加 **阶段十二**，标记为待执行：

```diff
+ ## 阶段十二：可恢复的任务依赖系统 (DAG Task System) 🕸️
+ **目标**：为 LLM Space 引入持久化、防死锁、高并发文件锁保护以及 Prompt Cache 缓存对齐的 DAG 任务依赖系统特性。
+ **工作项**：
+ - [x] **taskManager.js**：实现后端任务物理读写、Kahn 算法检测环、claim 写入锁。
+ - [x] **原子任务工具集**：完成 create_task, list_tasks, get_task, claim_task, complete_task 五个工具的编写与注册。
+ - [x] **TaskSystemPlugin.js**：完成 preLLM（静前动后缓存拆分注入）、preToolUse（拦截并广播 task_update）、onLoopEnd（崩溃事务自动回滚）。
+ - [x] **DELETE REST API**：重置 Session 时自动清空物理任务文件夹。
+ - [x] **TodoList.jsx**：React 组件渲染 blockedBy 依赖链及 Owner 分配。
```

- [ ] **Step 3: 更新 `status.md` 文档**
  在 `docs/memory/status.md` 中的最近突破和工具表格中加入 Task System 记录：

```diff
// 在“最近工程突破”末尾追加：
+ 21. **可恢复的任务依赖系统 (DAG Task System)**：实现类似 Claude Code 的持久化任务图系统，内置 Kahn 算法环检测、Claim 排他文件锁、Release Path 中断回滚事务，及前缀缓存（Prompt Cache）友好的静前动后拆分渲染逻辑。
```

- [ ] **Step 4: 提交代码**

```bash
git add harnesses/05-task-system.json docs/memory/plan.md docs/memory/status.md
git commit -m "feat: add 05-task-system preset and sync plan and status docs"
```
