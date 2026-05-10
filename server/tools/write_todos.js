/**
 * write_todos 工具
 * 这是一个纯前端状态更新工具——大模型调用它时，前端会拦截并直接更新 TODO 面板。
 * 后端注册此工具仅作为兜底（防止前端拦截逻辑遗漏时报"未知工具"的错误）。
 * 真正的 todos 数据由前端 TrajectoryPage 的 setTodos() 处理。
 */
const writeTodos = {
  name: 'write_todos',
  description: '更新前端面板中的 TODO 任务列表。在制定或更新多步任务计划时使用。每次更新都应该包含所有任务的完整状态。',
  parameters: {
    todos: {
      type: 'array',
      description: 'TODO 任务列表，每个元素包含 content（任务内容）、status（pending/in_progress/completed/failed）、priority（high/medium/low）',
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
    return `已更新 ${todos.length} 个 TODO 任务（待执行: ${counts.pending}, 进行中: ${counts.in_progress}, 已完成: ${counts.completed}）`;
  },
};

export default writeTodos;
