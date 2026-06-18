export function getUserMessagePresentation(message) {
  const isScheduled = message?.type === 'scheduled';
  const rawContent = String(message?.content || '');
  return {
    variant: isScheduled ? 'scheduled' : 'user',
    content: isScheduled ? rawContent.replace(/^\[Scheduled\]\s*/, '') : rawContent
  };
}
