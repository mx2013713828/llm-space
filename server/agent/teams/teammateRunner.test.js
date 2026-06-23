import test from 'node:test';
import assert from 'node:assert/strict';

import { runTeammate } from './teammateRunner.js';

class FakeExecutor {
  static instances = [];

  constructor(args) {
    FakeExecutor.instances.push(this);
    FakeExecutor.lastArgs = args;
    this.messages = [{ role: 'assistant', type: 'text', content: 'done' }];
  }

  async run(maxTurns) {
    FakeExecutor.lastRunMaxTurns = maxTurns;
  }
}

function createParentExecutor() {
  return {
    harnessId: 'h1',
    tools: [
      'bash',
      'write_todos',
      'spawn_teammate',
      'check_team_inbox',
      'send_team_message',
      { name: 'custom_tool', description: 'kept' },
    ],
    features: {
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
      },
      security_mode: 'strict',
    },
    model: { modelId: 'test-model' },
    temperature: 0.2,
    maxTokens: 1024,
    thinkingEnabled: true,
    skills: ['alpha'],
    onEvent() {},
  };
}

test('runTeammate creates a teammate child executor, marks running then completed, and sends a result to lead', async () => {
  FakeExecutor.instances = [];
  FakeExecutor.lastArgs = null;
  FakeExecutor.lastRunMaxTurns = null;

  const updates = [];
  const sentMessages = [];

  await runTeammate({
    parentExecutor: createParentExecutor(),
    teamId: 'team_1',
    teammateId: 'reviewer',
    name: 'Reviewer',
    role: 'Critic',
    initialPrompt: 'Review the patch.',
    maxTurns: 4,
    ExecutorClass: FakeExecutor,
    stateStore: {
      async updateTeammate(input) {
        updates.push(input);
      },
    },
    bus: {
      async sendMessage(input) {
        sentMessages.push(input);
      },
    },
  });

  assert.equal(FakeExecutor.instances.length, 1);
  assert.deepEqual(FakeExecutor.lastArgs.messages, [{ role: 'user', content: 'Review the patch.' }]);
  assert.equal(FakeExecutor.lastArgs.runtimeRole, 'teammate');
  assert.deepEqual(FakeExecutor.lastArgs.teamContext, {
    teamId: 'team_1',
    agentId: 'reviewer',
    leadId: 'lead',
  });
  assert.deepEqual(
    FakeExecutor.lastArgs.tools,
    ['bash', { name: 'custom_tool', description: 'kept' }, 'send_team_message'],
  );
  assert.equal(FakeExecutor.lastArgs.features.task_orchestration.mode, 'todo');
  assert.equal(FakeExecutor.lastArgs.features.enable_memory.enabled, false);
  assert.equal(FakeExecutor.lastRunMaxTurns, 4);

  assert.deepEqual(updates, [
    {
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'reviewer',
      updates: { state: 'running' },
    },
    {
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'reviewer',
      updates: { state: 'completed' },
    },
  ]);

  assert.deepEqual(sentMessages, [
    {
      harnessId: 'h1',
      teamId: 'team_1',
      from: 'reviewer',
      to: 'lead',
      type: 'result',
      payload: {
        teammateId: 'reviewer',
        name: 'Reviewer',
        role: 'Critic',
        content: 'done',
      },
    },
  ]);
});

test('runTeammate marks failed and sends an error message when execution throws', async () => {
  class FailingExecutor extends FakeExecutor {
    async run() {
      throw new Error('boom');
    }
  }

  const updates = [];
  const sentMessages = [];

  await assert.rejects(
    runTeammate({
      parentExecutor: createParentExecutor(),
      teamId: 'team_1',
      teammateId: 'reviewer',
      name: 'Reviewer',
      role: 'Critic',
      initialPrompt: 'Review the patch.',
      ExecutorClass: FailingExecutor,
      stateStore: {
        async updateTeammate(input) {
          updates.push(input);
        },
      },
      bus: {
        async sendMessage(input) {
          sentMessages.push(input);
        },
      },
    }),
    /boom/,
  );

  assert.deepEqual(updates, [
    {
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'reviewer',
      updates: { state: 'running' },
    },
    {
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'reviewer',
      updates: { state: 'failed', error: 'boom' },
    },
  ]);

  assert.deepEqual(sentMessages, [
    {
      harnessId: 'h1',
      teamId: 'team_1',
      from: 'reviewer',
      to: 'lead',
      type: 'error',
      payload: {
        teammateId: 'reviewer',
        name: 'Reviewer',
        role: 'Critic',
        error: 'boom',
      },
    },
  ]);
});
