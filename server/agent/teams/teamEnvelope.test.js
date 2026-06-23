import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TEAM_MESSAGE_TYPES,
  createMessageEnvelope,
  createTeamId,
  createTeammateId,
  validateAgentName,
} from './teamEnvelope.js';

test('validateAgentName accepts teammate names matching the required pattern', () => {
  assert.equal(validateAgentName('lead'), 'lead');
  assert.equal(validateAgentName('reviewer_2'), 'reviewer_2');
  assert.equal(validateAgentName('agent-42'), 'agent-42');
  assert.equal(validateAgentName('A'.repeat(40)), 'A'.repeat(40));
});

test('validateAgentName throws readable errors for invalid teammate names', () => {
  assert.throws(() => validateAgentName(''), /Invalid teammate name/);
  assert.throws(() => validateAgentName('with space'), /letters, numbers, underscore, and hyphen/);
  assert.throws(() => validateAgentName('!'), /Invalid teammate name/);
  assert.throws(() => validateAgentName('A'.repeat(41)), /1-40 characters/);
});

test('createTeamId and createTeammateId create prefixed ids', () => {
  const teamId = createTeamId();
  const teammateId = createTeammateId('reviewer');

  assert.match(teamId, /^team_[a-z0-9]+$/);
  assert.match(teammateId, /^teammate_reviewer$/);
});

test('createMessageEnvelope returns a fully formed envelope', () => {
  const envelope = createMessageEnvelope({
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'hello' },
  });

  assert.equal(TEAM_MESSAGE_TYPES.has(envelope.type), true);
  assert.match(envelope.id, /^msg_[a-z0-9]+$/);
  assert.match(envelope.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(envelope, {
    id: envelope.id,
    createdAt: envelope.createdAt,
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'hello' },
  });
});

test('createMessageEnvelope rejects unsupported message types', () => {
  assert.throws(
    () =>
      createMessageEnvelope({
        teamId: 'team_1',
        from: 'lead',
        to: 'reviewer',
        type: 'noop',
        payload: {},
      }),
    /Invalid team message type/,
  );
});
