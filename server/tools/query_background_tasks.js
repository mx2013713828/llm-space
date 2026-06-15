/**
 * query_background_tasks 工具
 * 用于查询当前在后台运行或已完成的历史任务。
 * 大模型调用它时，会被 AgentExecutor 直接拦截并返回结果。
 */
const queryBackgroundTasks = {
  name: 'query_background_tasks',
  description: 'Query the status, duration, and output preview of all background tasks (running or completed). Use this to track the progress of long-running commands spawned via bash run_in_background.',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  async execute() {
    // 实际执行在 AgentExecutor.js 的 preToolUse/循环拦截阶段完成，此处仅作占位符兜底。
    return '[]';
  },
};

export default queryBackgroundTasks;
