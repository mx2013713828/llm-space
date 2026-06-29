const TOOL_STATUS = {
  pending: { label: 'pending', tone: 'info' },
  running: { label: 'running', tone: 'info' },
  completed: { label: 'completed', tone: 'success' },
  invalid_args: { label: 'invalid args', tone: 'danger' },
  failed: { label: 'failed', tone: 'danger' },
};

const TEAMMATE_STATUS = {
  running: { label: 'running', tone: 'info' },
  completed: { label: 'completed', tone: 'success' },
  failed: { label: 'failed', tone: 'danger' },
  turn_limit: { label: 'turn limit', tone: 'danger' },
  no_result: { label: 'no result', tone: 'danger' },
};

export function getToolStatusPresentation(message = {}) {
  if (message.toolName === 'spawn_teammate') {
    if (message.toolStatus === 'invalid_args' || message.toolStatus === 'failed') {
      return TOOL_STATUS[message.toolStatus];
    }
    if (message.toolStatus === 'pending' || message.toolStatus === 'running') {
      return { label: 'launching', tone: 'info' };
    }
    if (message.toolStatus === 'completed' || message.toolOutput != null) {
      return { label: 'launched', tone: 'info' };
    }
  }

  const explicit = TOOL_STATUS[message.toolStatus];
  if (explicit) return explicit;
  if (message.toolOutput != null) return TOOL_STATUS.completed;
  return null;
}

export function getTeammateStatusPresentation(teammate = {}) {
  return TEAMMATE_STATUS[teammate.state] || {
    label: teammate.state || 'unknown',
    tone: 'info',
  };
}

export function getBadgeClassForTone(tone) {
  if (tone === 'success') return 'badge-green';
  if (tone === 'danger') return 'badge-red';
  if (tone === 'warning') return 'badge-amber';
  return 'badge-cyan';
}
