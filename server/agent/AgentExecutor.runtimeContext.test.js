import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentExecutor } from './AgentExecutor.js';

function createExecutor(overrides = {}) {
  return new AgentExecutor({
    harnessId: 'runtime-context-test',
    systemPrompt: 'You are a coding assistant.',
    features: {},
    tools: [],
    ...overrides,
  });
}

test('appends one runtime context block when constructing an executor', () => {
  const executor = createExecutor();

  assert.match(executor.systemPrompt, /^You are a coding assistant\.\n\n<runtime_context>/);
  assert.match(executor.systemPrompt, new RegExp(`<working_directory>${process.cwd()}</working_directory>`));
  assert.equal(executor.systemPrompt.match(/<runtime_context>/g)?.length, 1);
});

test('uses runtime context as the system prompt when the configured prompt is empty', () => {
  const executor = createExecutor({ systemPrompt: '' });

  assert.match(executor.systemPrompt, /^<runtime_context>/);
});
