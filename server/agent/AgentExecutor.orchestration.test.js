import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentExecutor } from './AgentExecutor.js';

function createExecutor(overrides = {}) {
  return new AgentExecutor({
    harnessId: 'orchestration-policy-test',
    systemPrompt: 'You are a coding assistant.',
    features: {},
    tools: [],
    ...overrides,
  });
}

test('parent-disabled orchestration strips every managed child tool but keeps current time once', () => {
  const executor = createExecutor({
    tools: ['bash', 'sub_agent', 'write_todos', 'query_background_tasks', 'schedule_cron', 'get_current_time'],
    features: {
      task_orchestration: {
        enabled: false,
        mode: 'task_system',
        enable_sub_agents: true,
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  assert.deepEqual(executor.tools.sort(), ['bash', 'get_current_time'].sort());
  assert.equal(executor.tools.filter(tool => tool === 'get_current_time').length, 1);
});

test('task-system mode mounts the task board tools once and preserves current time', () => {
  const executor = createExecutor({
    tools: ['bash', 'create_task', 'claim_task', 'get_current_time'],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'task_system',
      },
    },
  });

  assert.deepEqual(
    executor.tools.sort(),
    ['bash', 'create_task', 'list_tasks', 'get_task', 'claim_task', 'complete_task', 'get_current_time'].sort()
  );
  assert.equal(executor.tools.filter(tool => tool === 'get_current_time').length, 1);
});

test('background and cron tools require the canonical parent and child switches together', () => {
  const parentDisabled = createExecutor({
    tools: ['bash'],
    features: {
      task_orchestration: {
        enabled: false,
        mode: 'todo',
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  const childDisabled = createExecutor({
    tools: ['bash', 'query_background_tasks', 'schedule_cron'],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'todo',
        enable_background_tasks: false,
        enable_cron_scheduler: false,
      },
    },
  });

  const childEnabled = createExecutor({
    tools: ['bash'],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'todo',
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  assert.equal(parentDisabled.tools.includes('query_background_tasks'), false);
  assert.equal(parentDisabled.tools.includes('schedule_cron'), false);
  assert.equal(parentDisabled.tools.includes('list_crons'), false);
  assert.equal(parentDisabled.tools.includes('cancel_cron'), false);

  assert.equal(childDisabled.tools.includes('query_background_tasks'), false);
  assert.equal(childDisabled.tools.includes('schedule_cron'), false);
  assert.equal(childDisabled.tools.includes('list_crons'), false);
  assert.equal(childDisabled.tools.includes('cancel_cron'), false);

  assert.equal(childEnabled.tools.includes('query_background_tasks'), true);
  assert.equal(childEnabled.tools.includes('schedule_cron'), true);
  assert.equal(childEnabled.tools.includes('list_crons'), true);
  assert.equal(childEnabled.tools.includes('cancel_cron'), true);
  assert.equal(childEnabled.tools.filter(tool => tool === 'get_current_time').length, 1);
});
