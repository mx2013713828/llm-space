import crypto from 'node:crypto';

import { validateStorageId } from './teamPathGuards.js';

const AGENT_NAME_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export const TEAM_MESSAGE_TYPES = new Set([
  'message',
  'result',
  'error',
  'status',
]);

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

export function validateAgentName(name) {
  if (typeof name !== 'string' || !AGENT_NAME_PATTERN.test(name)) {
    throw new Error(
      'Invalid teammate name: must be 1-40 characters using only letters, numbers, underscore, and hyphen.',
    );
  }
  return name;
}

export function createTeamId() {
  return createId('team');
}

export function createTeammateId(name) {
  return `teammate_${validateAgentName(name)}`;
}

export function createMessageEnvelope(input) {
  const { teamId, from, to, type, payload } = input ?? {};

  validateStorageId('teamId', teamId);
  validateAgentName(from);
  validateAgentName(to);
  if (!TEAM_MESSAGE_TYPES.has(type)) {
    throw new Error(`Invalid team message type: ${type}`);
  }

  return {
    id: createId('msg'),
    createdAt: new Date().toISOString(),
    teamId,
    from,
    to,
    type,
    payload: payload ?? null,
  };
}
