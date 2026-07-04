import {
  buildStrategyContextBlock,
  buildStrategyIndexBlock,
  listExecutionStrategies,
  loadExecutionStrategy,
} from '../strategies/strategyRegistry.js';
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';

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

const STRATEGY_PROMPT_KEYS = {
  inline: 'inline_strategy_prompt',
  sequential_subagent: 'sequential_subagent_strategy_prompt',
  async_teams: 'async_teams_strategy_prompt',
  custom: 'custom_strategy_prompt',
};

function getStrategyGuidelineOverride(features, strategyId) {
  const promptKey = STRATEGY_PROMPT_KEYS[strategyId];
  if (!promptKey) return null;
  const value = features?.task_orchestration?.[promptKey];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
      appendSystemPromptSection(context, {
        id: 'execution_strategy_index',
        label: 'Available Execution Strategies',
        target: 'system',
        lifecycle: 'pinned',
        source: 'strategyRegistry:list',
        content: buildStrategyIndexBlock(strategies),
        order: 30,
        cacheImpact: 'stable_until_strategy_catalog_changes',
      });
    }

    if (!selectedStrategyId) {
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

    const guidelineOverride = getStrategyGuidelineOverride(executor.features, strategy.id);
    if (strategy.id === 'custom' && !guidelineOverride) {
      return;
    }

    const strategyContext = strategy.id === 'custom'
      ? `<active_execution_strategy id="${strategy.id}" name="${strategy.name}">
${guidelineOverride}
</active_execution_strategy>`
      : buildStrategyContextBlock({
          ...strategy,
          body: guidelineOverride || strategy.body,
        }, executor.features);
    appendSystemPromptSection(context, {
      id: 'active_execution_strategy',
      label: 'Active Execution Strategy',
      target: 'system',
      lifecycle: 'pinned',
      source: `strategy:${strategy.id}`,
      content: strategyContext,
      order: 40,
      cacheImpact: 'stable_until_selected_strategy_changes',
      metadata: {
        strategyId: strategy.id,
        strategyName: strategy.name,
        override: !!guidelineOverride,
      },
    });
  },
};
