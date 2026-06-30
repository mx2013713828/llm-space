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

test('presents blocked tool calls as a warning state', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'read_file',
    toolStatus: 'blocked',
    toolOutput: 'Sensitive file access is blocked.',
  }), {
    label: 'blocked',
    tone: 'warning',
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

test('presents wait_for_teammates timeout output as still running', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'wait_for_teammates',
    toolStatus: 'completed',
    toolOutput: 'Timed out waiting for teammates; 1 teammate(s) still unresolved.',
  }), {
    label: 'still running',
    tone: 'warning',
  });
});

test('presents wait_for_teammates all-terminal output as joined', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'wait_for_teammates',
    toolStatus: 'completed',
    toolOutput: 'All teammates reached terminal states.',
  }), {
    label: 'joined',
    tone: 'success',
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

test('presents teammate awaiting_permission as a warning state', () => {
  assert.deepEqual(getTeammateStatusPresentation({
    state: 'awaiting_permission',
  }), {
    label: 'awaiting permission',
    tone: 'warning',
  });
});

test('presents unknown teammate states as raw info states', () => {
  assert.deepEqual(getTeammateStatusPresentation({
    state: 'unexpected_teammate_state',
  }), {
    label: 'unexpected_teammate_state',
    tone: 'info',
  });
});
