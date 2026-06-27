export function getUserMessagePresentation(message) {
  const isScheduled = message?.type === 'scheduled';
  const rawContent = String(message?.content || '');
  return {
    variant: isScheduled ? 'scheduled' : 'user',
    content: isScheduled ? rawContent.replace(/^\[Scheduled\]\s*/, '') : rawContent
  };
}

export function getThinkingDisplayContent(content, folded) {
  const rawContent = String(content || '');
  if (!folded) return rawContent;
  return rawContent ? `[Thinking folded]\n${rawContent}` : '[Thinking folded]';
}

export function isAssistantTextFinalAnswer(turnMessages, messageIndex) {
  const message = turnMessages?.[messageIndex];
  if (!message || message.role !== 'assistant' || message.type !== 'text') return false;

  for (let i = messageIndex + 1; i < turnMessages.length; i++) {
    const nextMessage = turnMessages[i];
    if (nextMessage?.role === 'assistant' && nextMessage?.type === 'tool_call') {
      return false;
    }
  }

  return true;
}
