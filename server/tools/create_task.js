export default {
  name: 'create_task',
  description: '创建一个全新的任务。系统会自动利用 Kahn 拓扑排序算法校验是否存在环路，防止循环依赖。',
  parameters: {
    subject: { type: 'string', description: '任务标题 (例: "设计表结构")', required: true },
    description: { type: 'string', description: '详细的任务上下文及背景说明', required: false },
    blockedBy: { type: 'string', description: '该任务依赖的上游任务 ID 列表，以逗号分隔 (例: "task_cd34,task_ef56")', required: false }
  },
  async execute() {
    return '[create_task 拦截启动]';
  }
};
