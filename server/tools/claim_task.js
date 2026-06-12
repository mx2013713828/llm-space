export default {
  name: 'claim_task',
  description: '认领一个处于待开始状态的任务。只有当其依赖的所有上游任务均处于 completed 状态时，认领才能成功。系统自动施加并发排他锁。',
  parameters: {
    id: { type: 'string', description: '待认领任务的唯一 ID', required: true }
  },
  async execute() {
    return '[claim_task 拦截启动]';
  }
};
