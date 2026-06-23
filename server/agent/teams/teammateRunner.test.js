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

test('runTeammate still reports failure to lead when initial running-state update fails', async () => {
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
      ExecutorClass: FakeExecutor,
      stateStore: {
        async updateTeammate(input) {
          updates.push(input);
          if (updates.length === 1) {
            throw new Error('state write failed');
          }
        },
      },
      bus: {
        async sendMessage(input) {
          sentMessages.push(input);
        },
      },
    }),
    /state write failed/,
  );

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
        error: 'state write failed',
      },
    },
  ]);

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
      updates: { state: 'failed', error: 'state write failed' },
    },
  ]);
});

test('runTeammate isolates child harness state and suppresses raw child messages_update events', async () => {
  const forwardedEvents = [];

  class EventingExecutor extends FakeExecutor {
    async run() {
      FakeExecutor.lastArgs.onEvent('messages_update', {
        messages: [{ role: 'assistant', content: 'child transcript' }],
      });
      FakeExecutor.lastArgs.onEvent('tool_call', { tool: 'bash' });
    }
  }

  await runTeammate({
    parentExecutor: {
      ...createParentExecutor(),
      onEvent(type, payload) {
        forwardedEvents.push({ type, payload });
      },
    },
    teamId: 'team_1',
    teammateId: 'reviewer',
    name: 'Reviewer',
    role: 'Critic',
    initialPrompt: 'Review the patch.',
    ExecutorClass: EventingExecutor,
    stateStore: {
      async updateTeammate() {}
    },
    bus: {
      async sendMessage() {}
    },
  });

  assert.equal(FakeExecutor.lastArgs.harnessId, '');
  assert.deepEqual(forwardedEvents, [{ type: 'tool_call', payload: { tool: 'bash' } }]);
});
