import * as taskManager from '../utils/taskManager.js';
import { FEATURE_SCHEMA } from '../../../src/lib/FeatureSchema.js';

export const TaskSystemPlugin = {
  name: 'TaskSystemPlugin',

  async preLLM(context) {
    const { executor, apiMessages, turnIndex } = context;
    if (!executor) return;
    const harnessId = executor.harnessId || 'default';

    // 注入自定义的 task_system_prompt (带 XML 去重)
    const customPrompt = executor.features.task_manager?.task_system_prompt;
    let promptToInject = customPrompt;
    if (promptToInject === undefined || promptToInject === null) {
      promptToInject = FEATURE_SCHEMA.task_manager?.children?.task_system_prompt?.defaultValue || '';
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

    // 3. 动态状态差分注入：仅将高频变化的任务状态 Diff 附加到最后一轮 User 消息的末尾
    const stateSummary = tasks.map(t => {
      const ownerStr = t.owner ? ` (owner: ${t.owner})` : '';
      return `${t.id}: ${t.status}${ownerStr}`;
    }).join('\n');

    const dynamicSection = `\n<current_task_state_diff>\n${stateSummary}\n</current_task_state_diff>\n`;

    // 4. 催促警告注入：当 roundsSinceTaskAction >= 3 且存在未完成任务时，追加催促指令
    let nagSection = '';
    const hasActiveTasks = tasks.some(t => t.status !== 'completed');
    const rounds = executor.roundsSinceTaskAction || 0;
    if (rounds >= 3 && hasActiveTasks) {
      nagSection = `\n<system_reminder>\n你已连续 3 轮未更新任务看板了。请在继续执行下一步前，务必使用 claim_task 或 complete_task 保持任务进度同步。\n</system_reminder>\n`;
    }

    const payloadBlock = {
      type: 'text',
      text: `${dynamicSection}${nagSection}`
    };

    // 拼入最后一个 User 消息体中
    const lastMsg = apiMessages[apiMessages.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content = [...lastMsg.content, payloadBlock];
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

    // 只要调用了写入类型的任务工具，重置计时器
    if (['create_task', 'claim_task', 'complete_task'].includes(toolName)) {
      executor.roundsSinceTaskAction = 0;
      context.hasUpdatedTodoThisTurn = true; // 确保在 onLoopEnd 能正确阻断累加
    }

    try {
      if (toolName === 'create_task') {
        const tasks = await taskManager.loadTasks(harnessId);
        const taskId = `task_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
        
        // 兼容以逗号分隔的 blockedBy 字符串参数
        let rawBlocked = args.blockedBy || '';
        const blockedBy = typeof rawBlocked === 'string'
          ? rawBlocked.split(',').map(s => s.trim()).filter(Boolean)
          : (Array.isArray(rawBlocked) ? rawBlocked : []);

        const newTask = {
          id: taskId,
          subject: args.subject,
          description: args.description || '',
          status: 'pending',
          owner: null,
          blockedBy
        };

        // Kahn 算法 DAG 拓扑排序环路校验
        const tempTasks = [...tasks, newTask];
        if (taskManager.hasCycle(tempTasks)) {
          throw new Error(`[DAG Cycle Error] 无法创建任务 "${args.subject}"，因为所声明的依赖 blockedBy: [${blockedBy.join(', ')}] 会产生循环依赖(死锁)！`);
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

        // 寻找因为该任务完成而被解锁的下游任务
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

      // 状态同步广播：刷新 Executor 中的 todos 以回传前端更新
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

    tool.handled = true; // 拦截处理完毕，指示主循环不用再次执行物理工具
  },

  async onLoopEnd(context) {
    const { executor, hasUpdatedTodoThisTurn } = context;
    if (!executor) return;

    // Release Path 中断回滚事务
    // 一旦侦测到执行中途发生 crash、错误或 timeout 导致循环强退，自动回退 in_progress 任务并释放 owner 租约，避免悬挂死锁
    if (context.error || context.stopReason === 'error' || context.stopReason === 'timeout') {
      const harnessId = executor.harnessId || 'default';
      const tasks = await taskManager.loadTasks(harnessId);
      let changed = false;
      for (const t of tasks) {
        if (t.status === 'in_progress' && t.owner === 'agent') {
          t.status = 'pending';
          t.owner = null;
          await taskManager.saveTask(harnessId, t);
          changed = true;
          console.warn(`[TaskSystem Release Path] 捕获到 Agent 运行异常，已释放进行中任务并回滚为 pending: ${t.id}`);
        }
      }
      if (changed) {
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
      }
      return;
    }

    const harnessId = executor.harnessId || 'default';
    const tasks = await taskManager.loadTasks(harnessId);
    const hasActiveTasks = tasks.some(t => t.status !== 'completed');

    if (!hasActiveTasks || hasUpdatedTodoThisTurn) {
      executor.roundsSinceTaskAction = 0;
    } else {
      executor.roundsSinceTaskAction = (executor.roundsSinceTaskAction || 0) + 1;
    }
  }
};
