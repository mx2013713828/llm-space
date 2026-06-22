import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  getToolName,
  isOrchestrationEnabled,
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

test('isolates task-system delegation without background or cron tools', () => {
  const result = resolveOrchestrationTools([
    'bash',
    'sub_agent',
    'query_background_tasks',
    'schedule_cron',
  ], {
    enabled: true,
    mode: 'task_system',
    enable_sub_agents: true,
    enable_background_tasks: false,
    enable_cron_scheduler: false,
  });

  assert.deepEqual(result, [
    'bash',
    'create_task',
    'list_tasks',
    'get_task',
    'claim_task',
    'complete_task',
    'sub_agent',
  ]);
});

test('isolates background task mounting under todo mode', () => {
  const result = resolveOrchestrationTools([
    'bash',
    'query_background_tasks',
    'sub_agent',
    'schedule_cron',
  ], {
    enabled: true,
    mode: 'todo',
    enable_sub_agents: false,
    enable_background_tasks: true,
    enable_cron_scheduler: false,
  });

  assert.deepEqual(result, [
    'bash',
    'write_todos',
    'query_background_tasks',
  ]);
});

test('isolates cron mounting under task-system mode', () => {
  const result = resolveOrchestrationTools([
    'bash',
    'schedule_cron',
    'sub_agent',
    'query_background_tasks',
  ], {
    enabled: true,
    mode: 'task_system',
    enable_sub_agents: false,
    enable_background_tasks: false,
    enable_cron_scheduler: true,
  });

  assert.deepEqual(result, [
    'bash',
    'create_task',
    'list_tasks',
    'get_task',
    'claim_task',
    'complete_task',
    'schedule_cron',
    'list_crons',
    'cancel_cron',
  ]);
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

test('normalizes tool names and guards orchestration by parent and child switches', () => {
  assert.equal(getToolName('write_todos'), 'write_todos');
  assert.equal(getToolName({ name: 'sub_agent' }), 'sub_agent');
  assert.equal(getToolName({}), '');
  assert.equal(getToolName(null), '');
  assert.equal(getToolName(42), '');

  assert.equal(isOrchestrationEnabled({
    enabled: false,
    enable_sub_agents: true,
  }, 'enable_sub_agents'), false);
  assert.equal(isOrchestrationEnabled({
    enabled: true,
  }, 'enable_sub_agents'), false);
  assert.equal(isOrchestrationEnabled({
    enabled: true,
    enable_sub_agents: true,
  }, 'enable_sub_agents'), true);
  assert.equal(isOrchestrationEnabled({
    enabled: true,
  }), true);
  assert.equal(isOrchestrationEnabled({
    enabled: false,
  }), false);
});
