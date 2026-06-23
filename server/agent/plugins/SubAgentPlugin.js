import { runSubAgent } from '../subAgentProfile.js';

export const SubAgentPlugin = {
  name: 'SubAgentPlugin',

  async preToolUse(context) {
    const { tool, executor, ExecutorClass } = context;
    if (tool.toolName === 'sub_agent' && tool.toolInput?.prompt) {
      try {
        await runSubAgent({
          parentExecutor: executor,
          tool,
          ExecutorClass,
        });
      } catch (err) {
        tool.toolOutput = `[子代理异常崩溃]\n${err.message}`;
      }
      
      // 标记已被处理，不进入主原生工具执行流程
      tool.handled = true;
    }
  }
};
