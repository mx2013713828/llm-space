const EXECUTABLE_TOOL_STATUSES = new Set([undefined, null, '', 'pending']);

export function hasExecutableToolUse(blocks = []) {
  if (!Array.isArray(blocks)) return false;
  return blocks.some(block => {
    const isToolBlock = block?.type === 'tool_call' || block?.type === 'tool_use';
    return isToolBlock && !block.handled && EXECUTABLE_TOOL_STATUSES.has(block.toolStatus);
  });
}

export async function runPreLlmStage(context, { applyToolPolicy = () => {} } = {}) {
  await context.executor.hooks.dispatch('onLoopStart', context);
  applyToolPolicy(context);
  await context.executor.hooks.dispatch('preLLM', context);
  return context;
}

export async function runModelStage(context, { callModel }) {
  const stopReason = await callModel(context);
  context.stopReason = stopReason;
  context.executor.lastRunStopReason = stopReason;
  return stopReason;
}

export async function runToolStage(context, { toolsToRun = [], executeToolCall, isParallel = false } = {}) {
  if (isParallel) {
    await Promise.all(toolsToRun.map(executeToolCall));
  } else {
    for (const tool of toolsToRun) {
      await executeToolCall(tool);
    }
  }
  return toolsToRun;
}

export async function runStopStage({
  executor,
  context = { executor },
  clearSecurity = () => {},
  emitDone = () => {},
  logger = console,
} = {}) {
  try {
    await executor.hooks.dispatch('onLoopEnd', context);
  } catch (err) {
    logger.error?.('[AgentExecutor] final onLoopEnd cleanup failed:', err);
  }

  try {
    await executor.saveSession();
  } catch (err) {
    logger.error?.('[AgentExecutor] final session save failed:', err);
  }

  try {
    clearSecurity();
  } catch (err) {
    logger.error?.('[AgentExecutor] final security cleanup failed:', err);
  }

  try {
    emitDone();
  } catch (err) {
    logger.error?.('[AgentExecutor] final done event failed:', err);
  }
}
