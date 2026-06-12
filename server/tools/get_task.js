export default {
  name: 'get_task',
  description: '查询单个任务的完整详细属性 (包括详细描述及完整的依赖列表)。',
  parameters: {
    id: { type: 'string', description: '任务唯一 ID', required: true }
  },
  async execute() {
    return '[get_task 拦截启动]';
  }
};
