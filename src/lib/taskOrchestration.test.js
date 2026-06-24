import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES,
  getNextGroupFeatureState,
  getToolName,
  isOrchestrationEnabled,
  resolveOrchestrationTools,
} from './taskOrchestration.js';
import { FEATURE_SCHEMA } from './FeatureSchema.js';

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

test('lead gets team tools only when agent teams is enabled', () => {
  assert.deepEqual(
    resolveOrchestrationTools(['bash'], {
      enabled: true,
      mode: 'todo',
      enable_agent_teams: true,
    }),
    ['bash', 'write_todos', 'spawn_teammate', 'send_team_message', 'check_team_inbox']
  );
});

test('teammate only keeps team communication from orchestration tools', () => {
  assert.deepEqual(
    resolveOrchestrationTools([
      'bash',
      'write_todos',
      'spawn_teammate',
      'send_team_message',
      'check_team_inbox',
      'sub_agent',
    ], {
      enabled: true,
      mode: 'todo',
      enable_agent_teams: true,
    }, {
      runtimeRole: 'teammate',
    }),
    ['bash', 'send_team_message']
  );
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

test('managed orchestration tools hide delegation, background, task, and cron tools only', () => {
  assert.deepEqual(ORCHESTRATION_MANAGED_TOOL_NAMES, [
    'write_todos',
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
  assert.equal(ORCHESTRATION_MANAGED_TOOL_NAMES.includes('get_current_time'), false);
  assert.equal(ORCHESTRATION_MANAGED_TOOL_NAMES.includes('bash'), false);
});

test('hidden orchestration tools include teams tools for UI-managed filtering', () => {
  assert.deepEqual(TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES, [
    'write_todos',
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
    'spawn_teammate',
    'check_team_inbox',
    'send_team_message',
  ]);
});

test('preserves task orchestration child values when parent is disabled and re-enabled', () => {
  const taskOrchestration = FEATURE_SCHEMA.task_orchestration;
  const previousValue = {
    enabled: true,
    strategy: 'sequential_subagent',
    mode: 'task_system',
    todo_prompt: '<todo>custom</todo>',
    task_system_prompt: '<task>custom</task>',
    enable_background_tasks: true,
    enable_sub_agents: true,
    enable_agent_teams: true,
    enable_cron_scheduler: true,
  };

  const disabledValue = getNextGroupFeatureState(previousValue, taskOrchestration, false);
  assert.deepEqual(disabledValue, {
    ...previousValue,
    enabled: false,
  });

  const reenabledValue = getNextGroupFeatureState(disabledValue, taskOrchestration, true);
  assert.deepEqual(reenabledValue, {
    ...previousValue,
    enabled: true,
  });
});
