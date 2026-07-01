import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasExecutableToolUse,
  runModelStage,
  runPreLlmStage,
  runToolStage,
} from './agentLoopStages.js';

test('hasExecutableToolUse detects pending tool call messages', () => {
  assert.equal(hasExecutableToolUse([
    { role: 'assistant', type: 'text', content: 'Checking time.' },
    { role: 'assistant', type: 'tool_call', toolName: 'get_current_time', toolStatus: 'pending' },
  ]), true);
});

test('hasExecutableToolUse ignores terminal or invalid tool call messages', () => {
  assert.equal(hasExecutableToolUse([
    { role: 'assistant', type: 'tool_call', toolName: 'get_current_time', toolStatus: 'completed' },
    { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolStatus: 'invalid_args' },
    { role: 'assistant', type: 'tool_call', toolName: 'bash', toolStatus: 'blocked' },
  ]), false);
});

test('runPreLlmStage dispatches loop start, applies policy, then preLLM', async () => {
  const calls = [];
  const context = {
    executor: {
      hooks: {
        async dispatch(name) {
          calls.push(name);
        },
      },
    },
  };

  await runPreLlmStage(context, {
    applyToolPolicy() {
      calls.push('applyToolPolicy');
    },
  });

  assert.deepEqual(calls, ['onLoopStart', 'applyToolPolicy', 'preLLM']);
});

test('runModelStage stores the model stop reason on context and executor', async () => {
  const context = {
    executor: {
      lastRunStopReason: null,
    },
  };

  const stopReason = await runModelStage(context, {
    async callModel() {
      return 'tool_use';
    },
  });

  assert.equal(stopReason, 'tool_use');
  assert.equal(context.stopReason, 'tool_use');
  assert.equal(context.executor.lastRunStopReason, 'tool_use');
});

test('runToolStage executes tools serially by default', async () => {
  const calls = [];
  const toolsToRun = [{ id: 'a' }, { id: 'b' }];

  await runToolStage({}, {
    toolsToRun,
    async executeToolCall(tool) {
      calls.push(tool.id);
    },
  });

  assert.deepEqual(calls, ['a', 'b']);
});
