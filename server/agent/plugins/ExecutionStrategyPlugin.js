import {
  buildStrategyContextBlock,
  buildStrategyIndexBlock,
  listExecutionStrategies,
  loadExecutionStrategy,
} from '../strategies/strategyRegistry.js';

function appendTextContext(apiMessages, text) {
  if (!text) return;

  const payloadBlock = { type: 'text', text };
  const lastMsg = apiMessages[apiMessages.length - 1];
  const hasToolResult = lastMsg?.role === 'user'
    && Array.isArray(lastMsg.content)
    && lastMsg.content.some(block => block?.type === 'tool_result');

  if (lastMsg?.role === 'user' && !hasToolResult) {
    lastMsg.content = [...(Array.isArray(lastMsg.content) ? lastMsg.content : []), payloadBlock];
    return;
  }

  apiMessages.push({ role: 'user', content: [payloadBlock] });
}

export const ExecutionStrategyPlugin = {
  name: 'ExecutionStrategyPlugin',

  async preLLM(context) {
    const { executor, apiMessages } = context;
    const selectedStrategyId = executor?.selectedStrategyId;

    if (!executor || !apiMessages) {
      return;
    }

    if (executor.features?.task_orchestration?.enabled !== false && !context.systemPrompt.includes('<available_execution_strategies>')) {
      const strategies = await listExecutionStrategies();
      context.systemPrompt += `\n\n${buildStrategyIndexBlock(strategies)}`;
    }

    if (!selectedStrategyId || selectedStrategyId === 'custom') {
      return;
    }

    let strategy;
    try {
      strategy = await loadExecutionStrategy(selectedStrategyId);
    } catch (err) {
      appendTextContext(
        apiMessages,
        `<execution_strategy_error>Selected strategy "${selectedStrategyId}" could not be loaded: ${err.message}</execution_strategy_error>`
      );
      return;
    }

    const strategyContext = buildStrategyContextBlock(strategy, executor.features);
    appendTextContext(apiMessages, strategyContext);
  },
};
