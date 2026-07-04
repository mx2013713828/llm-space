import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';

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

test('tracks base prompt assembly sections', () => {
  const executor = createExecutor();

  assert.deepEqual(executor.promptAssemblySections.map(section => section.id), [
    'agent_guidance',
    'runtime_context',
  ]);
  assert.equal(executor.promptAssemblySections[0].target, 'system');
  assert.equal(executor.promptAssemblySections[1].source, 'runtime');
});

test('adds the current-time tool exactly once to every executor', () => {
  const withoutExplicitTool = createExecutor({ tools: [] });
  const withExplicitTool = createExecutor({ tools: ['get_current_time'] });

  assert.equal(withoutExplicitTool.tools.filter(name => name === 'get_current_time').length, 1);
  assert.equal(withExplicitTool.tools.filter(name => name === 'get_current_time').length, 1);
});
