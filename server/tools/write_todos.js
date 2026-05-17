/**
 * write_todos 工具
 * 这是一个纯前端状态更新工具——大模型调用它时，前端会拦截并直接更新 TODO 面板。
 * 后端注册此工具仅作为兜底（防止前端拦截逻辑遗漏时报"未知工具"的错误）。
 * 真正的 todos 数据由前端 TrajectoryPage 的 setTodos() 处理。
 */
const writeTodos = {
  name: 'write_todos',
  description: 'Update the TODO task list in the frontend panel. Use this when creating or updating a multi-step task plan. Every update should contain the complete state of all tasks.',
  parameters: {
    todos: {
      type: 'array',
      description: 'List of TODO tasks. Each element must contain content (task description), status (pending/in_progress/completed/failed), and priority (high/medium/low).',
      required: true,
    },
  },
  async execute({ todos }) {
    // 后端不做任何持久化，前端负责真正的状态更新
    // 此处仅返回确认消息，供大模型知道调用成功
    const counts = {
      pending: todos.filter(t => t.status === 'pending').length,
      in_progress: todos.filter(t => t.status === 'in_progress').length,
      completed: todos.filter(t => t.status === 'completed').length,
    };
    return `Successfully updated ${todos.length} TODO tasks (Pending: ${counts.pending}, In Progress: ${counts.in_progress}, Completed: ${counts.completed})`;
  },
};

export default writeTodos;
