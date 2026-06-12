export default {
  name: 'complete_task',
  description: '将一个进行中的任务标记为已完成 (completed)。系统会自动解锁由于该任务完成而不再受阻的下游任务。',
  parameters: {
    id: { type: 'string', description: '待完成任务的唯一 ID', required: true }
  },
  async execute() {
    return '[complete_task 拦截启动]';
  }
};
