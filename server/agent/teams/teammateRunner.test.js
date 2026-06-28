import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createTeammateHarnessId, runTeammate } from './teammateRunner.js';
import { EMPTY_TEAMMATE_RESULT } from './teammateProfile.js';

let originalCwd;
let testRoot;

before(async () => {
  originalCwd = process.cwd();
  testRoot = await mkdtemp(path.join(tmpdir(), 'teammate-runner-'));
  process.chdir(testRoot);
});

after(async () => {
  process.chdir(originalCwd);
  await rm(testRoot, { recursive: true, force: true });
});

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
  const events = [];
  const parentExecutor = createParentExecutor();
  parentExecutor.onEvent = (type, payload) => events.push({ type, payload });

  await runTeammate({
    parentExecutor,
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
    harnessId: 'h1',
  });
  assert.deepEqual(
    FakeExecutor.lastArgs.tools,
    ['bash', { name: 'custom_tool', description: 'kept' }, 'send_team_message'],
  );
  assert.equal(FakeExecutor.lastArgs.features.task_orchestration.mode, 'todo');
  assert.equal(FakeExecutor.lastArgs.features.enable_memory.enabled, false);
  assert.equal(FakeExecutor.lastRunMaxTurns, 4);

  assert.equal(updates.length, 2);
  assert.equal(updates[0].harnessId, 'h1');
  assert.equal(updates[0].teamId, 'team_1');
  assert.equal(updates[0].agentId, 'reviewer');
  assert.equal(updates[0].updates.state, 'running');
  assert.match(updates[0].updates.startedAt, /^\d{4}-/);
  assert.equal(updates[1].updates.state, 'completed');
  assert.equal(updates[1].updates.lastResult, 'done');
  assert.equal(updates[1].updates.traceRef.traceId, 'team_1_reviewer');
  assert.equal(updates[1].updates.traceRef.summary.messageCount, 1);
  assert.match(updates[1].updates.completedAt, /^\d{4}-/);
  assert.deepEqual(events.map(event => event.type), ['team_update', 'team_update']);
  assert.equal(events[0].payload.teammates[0].state, 'running');
  assert.equal(events[1].payload.teammates[0].state, 'completed');
  assert.equal(events[1].payload.teammates[0].lastResult, 'done');
  assert.equal(events[1].payload.teammates[0].traceRef.traceId, 'team_1_reviewer');

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
  const events = [];
  const parentExecutor = createParentExecutor();
  parentExecutor.onEvent = (type, payload) => events.push({ type, payload });

  await assert.rejects(
    runTeammate({
      parentExecutor,
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

  assert.equal(updates.length, 2);
  assert.equal(updates[0].updates.state, 'running');
  assert.match(updates[0].updates.startedAt, /^\d{4}-/);
  assert.equal(updates[1].updates.state, 'failed');
  assert.equal(updates[1].updates.error, 'boom');
  assert.match(updates[1].updates.completedAt, /^\d{4}-/);
  assert.deepEqual(events.map(event => event.type), ['team_update', 'team_update']);
  assert.equal(events[0].payload.teammates[0].state, 'running');
  assert.equal(events[1].payload.teammates[0].state, 'failed');
  assert.equal(events[1].payload.teammates[0].error, 'boom');

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

test('runTeammate marks turn_limit when child exhausts max turns', async () => {
  class TurnLimitedExecutor extends FakeExecutor {
    async run() {
      this.lastRunStopReason = 'turn_limit';
    }
  }

  const updates = [];
  const sentMessages = [];
  const events = [];
  const parentExecutor = createParentExecutor();
  parentExecutor.onEvent = (type, payload) => events.push({ type, payload });

  await runTeammate({
    parentExecutor,
    teamId: 'team_1',
    teammateId: 'reviewer',
    name: 'Reviewer',
    role: 'Critic',
    initialPrompt: 'Review the patch.',
    maxTurns: 1,
    ExecutorClass: TurnLimitedExecutor,
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

  assert.equal(updates[1].updates.state, 'turn_limit');
  assert.match(updates[1].updates.error, /max turns/i);
  assert.equal(events[1].payload.teammates[0].state, 'turn_limit');
  assert.equal(sentMessages[0].type, 'error');
  assert.match(sentMessages[0].payload.error, /max turns/i);
});

test('runTeammate marks no_result when child finishes without final assistant text', async () => {
  class NoResultExecutor extends FakeExecutor {
    constructor(args) {
      super(args);
      this.messages = [{ role: 'assistant', type: 'thinking', content: 'working' }];
    }
  }

  const updates = [];
  const sentMessages = [];
  const events = [];
  const parentExecutor = createParentExecutor();
  parentExecutor.onEvent = (type, payload) => events.push({ type, payload });

  await runTeammate({
    parentExecutor,
    teamId: 'team_1',
    teammateId: 'reviewer',
    name: 'Reviewer',
    role: 'Critic',
    initialPrompt: 'Review the patch.',
    ExecutorClass: NoResultExecutor,
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

  assert.equal(updates[1].updates.state, 'no_result');
  assert.equal(updates[1].updates.lastResult, EMPTY_TEAMMATE_RESULT);
  assert.match(updates[1].updates.error, /final text report/i);
  assert.equal(events[1].payload.teammates[0].state, 'no_result');
  assert.equal(sentMessages[0].type, 'error');
  assert.equal(sentMessages[0].payload.status, 'no_result');
  assert.match(sentMessages[0].payload.error, /final text report/i);
});

test('runTeammate does not treat pre-tool progress text as the final report', async () => {
  class ProgressThenToolExecutor extends FakeExecutor {
    constructor(args) {
      super(args);
      this.messages = [
        { role: 'assistant', type: 'text', content: 'I will inspect the files first.' },
        { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source code' },
      ];
    }
  }

  const updates = [];
  const sentMessages = [];

  await runTeammate({
    parentExecutor: createParentExecutor(),
    teamId: 'team_1',
    teammateId: 'reviewer',
    name: 'Reviewer',
    role: 'Critic',
    initialPrompt: 'Review the patch.',
    ExecutorClass: ProgressThenToolExecutor,
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

  assert.equal(updates[1].updates.state, 'no_result');
  assert.equal(updates[1].updates.lastResult, EMPTY_TEAMMATE_RESULT);
  assert.match(updates[1].updates.error, /final text report/i);
  assert.equal(sentMessages[0].type, 'error');
  assert.equal(sentMessages[0].payload.status, 'no_result');
  assert.equal(sentMessages[0].payload.lastToolName, 'read_file');
  assert.match(sentMessages[0].payload.error, /final text report/i);
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

  assert.equal(updates.length, 2);
  assert.equal(updates[0].updates.state, 'running');
  assert.match(updates[0].updates.startedAt, /^\d{4}-/);
  assert.equal(updates[1].updates.state, 'failed');
  assert.equal(updates[1].updates.error, 'state write failed');
  assert.match(updates[1].updates.completedAt, /^\d{4}-/);
});

test('runTeammate isolates child harness state and suppresses raw child stream events', async () => {
  const forwardedEvents = [];

  class EventingExecutor extends FakeExecutor {
    async run() {
      FakeExecutor.lastArgs.onEvent('messages_update', {
        messages: [{ role: 'assistant', content: 'child transcript' }],
      });
      FakeExecutor.lastArgs.onEvent('text_start', { id: 'child_text' });
      FakeExecutor.lastArgs.onEvent('text_delta', { id: 'child_text', text: 'child streamed text' });
      FakeExecutor.lastArgs.onEvent('tool_start', { id: 'child_tool', name: 'bash' });
      FakeExecutor.lastArgs.onEvent('tool_exec_done', { id: 'child_tool', output: 'child output' });
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

  assert.equal(FakeExecutor.lastArgs.harnessId, 'h1_reviewer');
  assert.notEqual(FakeExecutor.lastArgs.harnessId, 'h1');
  assert.equal(FakeExecutor.lastArgs.teamContext.harnessId, 'h1');
  assert.deepEqual(
    forwardedEvents
      .filter(event => event.type !== 'team_update')
      .map(event => event.type),
    [],
  );
  assert.deepEqual(forwardedEvents.filter(event => event.type === 'team_update').map(event => event.payload.teammates[0].state), [
    'running',
    'completed',
  ]);
});

test('createTeammateHarnessId returns a non-empty storage-safe id', () => {
  assert.equal(
    createTeammateHarnessId('harness/with spaces', 'teammate:reviewer'),
    'harness_with_spaces_teammate_reviewer',
  );
  assert.equal(createTeammateHarnessId('', ''), 'team_teammate');
});
