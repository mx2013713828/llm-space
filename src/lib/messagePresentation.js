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
