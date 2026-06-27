import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createTeammateFeatures,
  createTeammateSystemPrompt,
  selectTeammateTools,
} from './teammateProfile.js';

test('createTeammateFeatures deep-clones parent settings and disables memory plus non-team orchestration features', () => {
  const parentFeatures = {
    task_orchestration: {
      enabled: true,
      mode: 'task_system',
      enable_sub_agents: true,
      enable_background_tasks: true,
      enable_agent_teams: true,
      enable_cron_scheduler: true,
    },
    enable_memory: {
      enabled: true,
      provider: 'local',
    },
    security_mode: 'strict',
  };

  const childFeatures = createTeammateFeatures(parentFeatures);

  assert.notEqual(childFeatures, parentFeatures);
  assert.notEqual(childFeatures.task_orchestration, parentFeatures.task_orchestration);
  assert.notEqual(childFeatures.enable_memory, parentFeatures.enable_memory);
  assert.deepEqual(childFeatures.task_orchestration, {
    enabled: true,
    mode: 'todo',
    enable_sub_agents: false,
    enable_background_tasks: false,
    enable_agent_teams: true,
    enable_cron_scheduler: false,
  });
  assert.deepEqual(childFeatures.enable_memory, {
    enabled: false,
    provider: 'local',
  });
  assert.equal(childFeatures.security_mode, 'strict');
  assert.equal(parentFeatures.task_orchestration.mode, 'task_system');
  assert.equal(parentFeatures.enable_memory.enabled, true);
});

test('selectTeammateTools keeps atomic parent tools and send_team_message only', () => {
  const selectedTools = selectTeammateTools([
    'bash',
    'get_current_time',
    'write_todos',
    'spawn_teammate',
    'check_team_inbox',
    'send_team_message',
    'sub_agent',
    { name: 'custom_tool', description: 'kept' },
  ]);

  assert.deepEqual(
    selectedTools,
    ['bash', 'get_current_time', { name: 'custom_tool', description: 'kept' }, 'send_team_message'],
  );
});

test('createTeammateSystemPrompt includes the role when provided', () => {
  assert.equal(
    createTeammateSystemPrompt({ name: 'Reviewer', role: 'Critic' }),
    [
      'You are teammate Reviewer.',
      'Role: Critic',
      'You are an asynchronous teammate helping the Lead agent.',
      'Do not spawn agents, create scheduled jobs, or manage the Lead task board.',
      'Send important progress or final results to the Lead with send_team_message.',
      'Your final turn must be a plain text report for the Lead, not a tool call.',
      'Do not rely only on send_team_message for your final result; also end with the same report as assistant text.',
      'If you used tools, synthesize their results in that final text report.',
      'When done, return a concise final answer.',
    ].join('\n'),
  );
});

test('createTeammateSystemPrompt omits the role line when absent', () => {
  assert.equal(
    createTeammateSystemPrompt({ name: 'Reviewer' }),
    [
      'You are teammate Reviewer.',
      'You are an asynchronous teammate helping the Lead agent.',
      'Do not spawn agents, create scheduled jobs, or manage the Lead task board.',
      'Send important progress or final results to the Lead with send_team_message.',
      'Your final turn must be a plain text report for the Lead, not a tool call.',
      'Do not rely only on send_team_message for your final result; also end with the same report as assistant text.',
      'If you used tools, synthesize their results in that final text report.',
      'When done, return a concise final answer.',
    ].join('\n'),
  );
});
