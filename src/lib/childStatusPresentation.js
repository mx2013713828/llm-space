const CHILD_STATUS = {
  running: {
    label: 'running',
    tone: 'info',
    isTerminal: false,
    isWaitingForPermission: false,
  },
  awaiting_permission: {
    label: 'awaiting permission',
    tone: 'warning',
    isTerminal: false,
    isWaitingForPermission: true,
  },
  completed: {
    label: 'completed',
    tone: 'success',
    isTerminal: true,
    isWaitingForPermission: false,
  },
  failed: {
    label: 'failed',
    tone: 'danger',
    isTerminal: true,
    isWaitingForPermission: false,
  },
  no_result: {
    label: 'no result',
    tone: 'danger',
    isTerminal: true,
    isWaitingForPermission: false,
  },
  cancelled: {
    label: 'cancelled',
    tone: 'warning',
    isTerminal: true,
    isWaitingForPermission: false,
  },
};

export function getChildStatusPresentation(child = {}) {
  const status = child.status || child.state || 'running';
  const presentation = CHILD_STATUS[status] || {
    label: status,
    tone: 'info',
    isTerminal: false,
    isWaitingForPermission: false,
  };

  return {
    status,
    label: presentation.label,
    tone: presentation.tone,
    isTerminal: presentation.isTerminal,
    isWaitingForPermission: presentation.isWaitingForPermission,
    action: child.currentAction || child.error || '',
    toolCount: Number.isFinite(child.toolCount) ? child.toolCount : 0,
  };
}

export function getChildDisplayName(child = {}) {
  if (child.name) return child.name;
  if (child.agentId) return child.agentId;
  if (child.childId) return child.childId;
  if (child.childType === 'sub_agent') return 'sub-agent';
  if (child.childType === 'teammate') return 'teammate';
  return 'child agent';
}
