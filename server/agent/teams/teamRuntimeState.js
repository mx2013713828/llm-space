export const TERMINAL_TEAMMATE_STATES = new Set([
  'completed',
  'failed',
  'no_result',
  'cancelled',
]);

export function isTerminalTeammateState(state) {
  return TERMINAL_TEAMMATE_STATES.has(state);
}

export function getUnresolvedTeammates(state) {
  return Object.values(state?.teammates ?? {})
    .filter(teammate => !isTerminalTeammateState(teammate.state));
}

export function formatTeammateStatusLine(teammate = {}) {
  const name = teammate.name || teammate.agentId || 'teammate';
  const state = teammate.state || 'unknown';
  const detail = teammate.error || teammate.currentAction || '';
  return `- ${name}: ${state}${detail ? ` (${detail})` : ''}`;
}
