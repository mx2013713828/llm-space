import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTeammateStatusLine,
  getUnresolvedTeammates,
  isTerminalTeammateState,
} from './teamRuntimeState.js';

test('classifies terminal teammate states', () => {
  assert.equal(isTerminalTeammateState('completed'), true);
  assert.equal(isTerminalTeammateState('failed'), true);
  assert.equal(isTerminalTeammateState('cancelled'), true);
  assert.equal(isTerminalTeammateState('no_result'), true);
  assert.equal(isTerminalTeammateState('running'), false);
  assert.equal(isTerminalTeammateState('awaiting_permission'), false);
  assert.equal(isTerminalTeammateState('unknown'), false);
});

test('selects unresolved teammates from persisted team state', () => {
  const unresolved = getUnresolvedTeammates({
    teammates: {
      reviewer: { agentId: 'reviewer', state: 'completed' },
      tests: { agentId: 'tests', state: 'awaiting_permission' },
      backend: { agentId: 'backend', state: 'running' },
      frontend: { agentId: 'frontend', state: 'failed' },
    },
  });

  assert.deepEqual(unresolved.map(teammate => teammate.agentId), ['tests', 'backend']);
});

test('formats teammate status with permission action detail', () => {
  assert.equal(
    formatTeammateStatusLine({
      name: 'tests',
      agentId: 'teammate_tests',
      state: 'awaiting_permission',
      currentAction: 'waiting for permission: write_file',
    }),
    '- tests: awaiting_permission (waiting for permission: write_file)',
  );
});

test('formats teammate status with error detail before action detail', () => {
  assert.equal(
    formatTeammateStatusLine({
      name: 'frontend',
      state: 'no_result',
      error: 'missing final report',
      currentAction: 'writing final answer',
    }),
    '- frontend: no_result (missing final report)',
  );
});
