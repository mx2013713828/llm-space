import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  resolveOrchestrationTools,
} from './taskOrchestration.js';

test('removes every managed tool when orchestration is disabled', () => {
  const requested = ['bash', 'sub_agent', { name: 'schedule_cron' }, 'write_todos'];
  assert.deepEqual(resolveOrchestrationTools(requested, {
    enabled: false,
    mode: 'task_system',
    enable_sub_agents: true,
    enable_cron_scheduler: true,
  }), ['bash']);
});

test('mounts only the enabled orchestration capabilities without duplicates', () => {
  const result = resolveOrchestrationTools(['bash', 'sub_agent', 'bash'], {
    enabled: true,
    mode: 'task_system',
    enable_sub_agents: true,
    enable_background_tasks: true,
    enable_cron_scheduler: true,
  });

  assert.deepEqual(result, [
    'bash',
    'create_task',
    'list_tasks',
    'get_task',
    'claim_task',
    'complete_task',
    'sub_agent',
    'query_background_tasks',
    'schedule_cron',
    'list_crons',
    'cancel_cron',
  ]);
  assert.equal(new Set(ORCHESTRATION_MANAGED_TOOL_NAMES).size, ORCHESTRATION_MANAGED_TOOL_NAMES.length);
});

test('uses todo mode as the planning source and respects other child switches', () => {
  const result = resolveOrchestrationTools([
    'bash',
    { name: 'write_todos' },
    { name: 'sub_agent' },
    { name: 'schedule_cron' },
    'custom_tool',
  ], {
    enabled: true,
    mode: 'todo',
    enable_sub_agents: false,
    enable_background_tasks: false,
    enable_cron_scheduler: false,
  });

  assert.deepEqual(result, ['bash', 'custom_tool', 'write_todos']);
});

test('treats object-valued managed tools the same as string tools', () => {
  const result = resolveOrchestrationTools([
    { name: 'sub_agent' },
    { name: 'schedule_cron' },
    { name: 'write_todos' },
    { name: 'write_todos' },
    { name: 'custom_tool' },
  ], {
    enabled: true,
    mode: 'todo',
    enable_sub_agents: true,
    enable_background_tasks: false,
    enable_cron_scheduler: true,
  });

  assert.deepEqual(result, [
    { name: 'custom_tool' },
    'write_todos',
    'sub_agent',
    'schedule_cron',
    'list_crons',
    'cancel_cron',
  ]);
});
