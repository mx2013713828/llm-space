function findLastAssistantTextEntry(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const message = entries[i];
    if (
      message?.role === 'assistant'
      && message?.type === 'text'
      && typeof message?.content === 'string'
      && message.content.trim()
    ) {
      return { index: i, content: message.content };
    }
  }

  return null;
}

function findLastToolEntry(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const message = entries[i];
    if (message?.role === 'assistant' && message?.type === 'tool_call') {
      return { index: i, toolName: message.toolName || '' };
    }
  }

  return null;
}

export function buildTeammateOutcome({ messages = [], stopReason = '', maxTurns = 8 } = {}) {
  const entries = Array.isArray(messages) ? messages : [];
  const lastTool = findLastToolEntry(entries);
  const finalText = findLastAssistantTextEntry(entries);
  const messageCount = entries.length;

  if (stopReason === 'turn_limit') {
    return {
      status: 'turn_limit',
      content: '',
      error: `Teammate exhausted max turns (${maxTurns}) before producing a final answer.`,
      lastToolName: lastTool?.toolName || null,
      messageCount,
    };
  }

  if (!finalText || (lastTool && finalText.index <= lastTool.index)) {
    return {
      status: 'no_result',
      content: '',
      error: lastTool
        ? 'Teammate finished without a final text report after its last tool call.'
        : 'Teammate finished without a final text report.',
      lastToolName: lastTool?.toolName || null,
      messageCount,
    };
  }

  return {
    status: 'completed',
    content: finalText.content,
    error: null,
    lastToolName: lastTool?.toolName || null,
    messageCount,
  };
}
