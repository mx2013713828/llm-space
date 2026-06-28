import test from 'node:test';
import assert from 'node:assert/strict';

import { getSpawnCardTeammate } from './teamStatusPresentation.js';

test('selects only the teammate that belongs to a spawn card', () => {
  const teamStatus = {
    teammates: [
      { agentId: 'teammate_backend-checker', name: 'backend-checker', state: 'running' },
      { agentId: 'teammate_frontend-checker', name: 'frontend-checker', state: 'completed' },
    ],
  };

  assert.deepEqual(
    getSpawnCardTeammate(teamStatus, { name: 'frontend-checker' }),
    { agentId: 'teammate_frontend-checker', name: 'frontend-checker', state: 'completed' },
  );
});

test('returns null when a spawn card has no matching teammate', () => {
  assert.equal(
    getSpawnCardTeammate({ teammates: [{ agentId: 'teammate_backend', name: 'backend' }] }, { name: 'tests' }),
    null,
  );
});
