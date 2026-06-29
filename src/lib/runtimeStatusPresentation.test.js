import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getTeammateStatusPresentation,
  getToolStatusPresentation,
} from './runtimeStatusPresentation.js';

test('presents invalid tool args as an error state', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'read_file',
    toolStatus: 'invalid_args',
  }), {
    label: 'invalid args',
    tone: 'danger',
  });
});

test('infers completed tool status when output exists', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'read_file',
    toolOutput: 'done',
  }), {
    label: 'completed',
    tone: 'success',
  });
});

test('presents completed spawn_teammate tool calls as launched, not teammate completed', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'spawn_teammate',
    toolStatus: 'completed',
    toolOutput: '{"teamId":"team_1","status":"running"}',
  }), {
    label: 'launched',
    tone: 'info',
  });
});

test('presents teammate no_result as an error state', () => {
  assert.deepEqual(getTeammateStatusPresentation({
    state: 'no_result',
  }), {
    label: 'no result',
    tone: 'danger',
  });
});
