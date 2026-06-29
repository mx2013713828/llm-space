import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getChildStatusPresentation,
  getChildDisplayName,
} from './childStatusPresentation.js';

test('presents a running child from status', () => {
  assert.deepEqual(getChildStatusPresentation({
    status: 'running',
    currentAction: 'reading files',
    toolCount: 2,
  }), {
    status: 'running',
    label: 'running',
    tone: 'info',
    isTerminal: false,
    isWaitingForPermission: false,
    action: 'reading files',
    toolCount: 2,
  });
});

test('presents awaiting permission as a warning child state', () => {
  assert.deepEqual(getChildStatusPresentation({
    state: 'awaiting_permission',
    currentTool: 'write_file',
    currentAction: 'waiting for permission: write_file',
  }), {
    status: 'awaiting_permission',
    label: 'awaiting permission',
    tone: 'warning',
    isTerminal: false,
    isWaitingForPermission: true,
    action: 'waiting for permission: write_file',
    toolCount: 0,
  });
});

test('presents terminal child states', () => {
  assert.equal(getChildStatusPresentation({ status: 'completed' }).isTerminal, true);
  assert.equal(getChildStatusPresentation({ state: 'failed' }).tone, 'danger');
  assert.equal(getChildStatusPresentation({ state: 'no_result' }).label, 'no result');
  assert.equal(getChildStatusPresentation({ state: 'turn_limit' }).label, 'turn limit');
  assert.equal(getChildStatusPresentation({ state: 'cancelled' }).label, 'cancelled');
});

test('derives a stable child display name', () => {
  assert.equal(getChildDisplayName({ name: 'frontend-checker' }), 'frontend-checker');
  assert.equal(getChildDisplayName({ agentId: 'teammate_backend' }), 'teammate_backend');
  assert.equal(getChildDisplayName({ childType: 'sub_agent' }), 'sub-agent');
  assert.equal(getChildDisplayName({}), 'child agent');
});
