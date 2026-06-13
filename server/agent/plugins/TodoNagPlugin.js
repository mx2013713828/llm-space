import { injectTodoState } from '../messageBuilder.js';

export const TodoNagPlugin = {
  name: 'TodoNagPlugin',

  async preLLM(context) {
    // 调用现有的注入逻辑，将 current_tasks_status 附加到 apiMessages 末尾
    context.apiMessages = injectTodoState(
      context.apiMessages, 
      context.executor.todos, 
      context.executor.roundsSinceTodo
    );
  },

  async preToolUse(context) {
    // 拦截 write_todos 的执行以更新计数器
    const { tool } = context;
    if (tool.toolName === 'write_todos') {
      context.executor.todos = tool.toolInput?.todos || [];
      context.hasUpdatedTodoThisTurn = true;

      const completedCount = context.executor.todos.filter(t => t.status === 'completed').length;
      tool.toolOutput = `[系统] 已更新看板。当前进度: ${completedCount}/${context.executor.todos.length} 已完成。`;
      
      // 触发更新事件给前端
      context.executor.onEvent('todo_update', { todos: context.executor.todos });
      
      // 标记该工具已经被插件内部处理，主循环无需再次执行
      tool.handled = true;
    }
  },

  async onLoopEnd(context) {
    // 轮数累加逻辑：只有存在未完成的 TODO，且本轮未更新时才累加，否则归零
    const hasActiveTodos = (context.executor.todos || []).some(t => t.status !== 'completed');

    if (!hasActiveTodos || context.hasUpdatedTodoThisTurn) {
      context.executor.roundsSinceTodo = 0;
    } else {
      context.executor.roundsSinceTodo = (context.executor.roundsSinceTodo || 0) + 1;
    }
  }
};
