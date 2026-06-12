export default {
  name: 'list_tasks',
  description: '列出当前会话下的所有任务及其完成状态、所属 Owner 和依赖情况。',
  parameters: {},
  async execute() {
    return '[list_tasks 拦截启动]';
  }
};
