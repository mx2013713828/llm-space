import { AgentExecutor } from '../AgentExecutor.js';

export const SubAgentPlugin = {
  name: 'SubAgentPlugin',

  async preToolUse(context) {
    const { tool, executor } = context;
    if (tool.toolName === 'sub_agent' && tool.toolInput?.prompt) {
      try {
        // 实例化子代理：继承主配置，但过滤掉 sub_agent 工具防套娃
        const subExecutor = new AgentExecutor({
          messages: [{ role: 'user', content: tool.toolInput.prompt }],
          systemPrompt: '你是一个子代理（Sub-agent）。请根据用户的具体任务，利用工具完成研究或操作。完成任务后，请输出最终的总结报告。请尽力而为，如果尝试多次失败也请如实报告。',
          tools: executor.tools.filter(t => t.name !== 'sub_agent'),
          features: executor.features,
          model: executor.model,
          temperature: executor.temperature,
          maxTokens: executor.maxTokens,
          thinkingEnabled: executor.thinkingEnabled,
          onEvent: (subType, subPayload) => {
            // 将子代理的事件透传给前端，但带上 parentToolCallId 以便前端在 UI 中渲染二级轨迹
            executor.onEvent(subType, { ...subPayload, parentToolCallId: tool.id });
          }
        });

        // 子代理执行
        await subExecutor.run();

        // 从子代理最终产生的内容中，提炼文字总结
        const textBlocks = subExecutor.messages.filter(m => m.type === 'text').map(m => m.content);
        tool.toolOutput = textBlocks.length > 0 ? textBlocks.join('') : '(子代理运行完毕，未返回任何文字总结)';
      } catch (err) {
        tool.toolOutput = `[子代理异常崩溃]\n${err.message}`;
      }
      
      // 标记已被处理，不进入主原生工具执行流程
      tool.handled = true;
    }
  }
};
