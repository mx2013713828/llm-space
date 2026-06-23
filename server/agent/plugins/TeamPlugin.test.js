import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentExecutor } from '../AgentExecutor.js';
import { createTeamBus } from '../teams/teamBus.js';
import { createTeamStateStore } from '../teams/teamStateStore.js';
import { createTeamPlugin } from './TeamPlugin.js';

async function createFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-plugin-'));
  return {
    rootDir,
    bus: createTeamBus({ rootDir }),
    stateStore: createTeamStateStore({ rootDir }),
  };
}

function createTool(toolName, toolInput) {
  return { id: `${toolName}_1`, toolName, toolInput };
}

test('spawn_teammate validates name, persists teammate state, and starts runTeammate without blocking', async () => {
  const fixture = await createFixture();
  const runCalls = [];
  let resolveRun;
  const runStarted = new Promise(resolve => {
    resolveRun = resolve;
  });

  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    runTeammateFn(input) {
      runCalls.push(input);
      return runStarted;
    },
  });

  const tool = createTool('spawn_teammate', {
    name: 'reviewer',
    role: 'Critic',
    prompt: 'Review the patch.',
    maxTurns: 4,
  });

  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  const output = JSON.parse(tool.toolOutput);
  assert.equal(output.status, 'running');
  assert.equal(output.teammateId, 'teammate_reviewer');
  assert.equal(runCalls.length, 1);

  const state = await fixture.stateStore.loadState({
    harnessId: 'h1',
    teamId: output.teamId,
  });
  assert.equal(state.teamId, output.teamId);
  assert.equal(state.teammates.teammate_reviewer.agentId, 'teammate_reviewer');
  assert.equal(state.teammates.teammate_reviewer.role, 'Critic');

  const invalidTool = createTool('spawn_teammate', {
    name: 'bad name',
    prompt: 'Should fail.',
  });

  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool: invalidTool,
  });

  assert.equal(invalidTool.handled, true);
  assert.match(invalidTool.toolOutput, /Invalid teammate name/);

  resolveRun();
  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('spawn_teammate clamps maxTurns to a finite positive integer with safe defaults', async () => {
  const fixture = await createFixture();
  const runCalls = [];
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn(input) {
      runCalls.push(input);
    },
  });

  const hugeTool = createTool('spawn_teammate', {
    name: 'reviewer',
    prompt: 'Review the patch.',
    maxTurns: 9999,
  });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool: hugeTool,
  });

  const invalidTool = createTool('spawn_teammate', {
    name: 'implementer',
    prompt: 'Implement the patch.',
    maxTurns: Number.NaN,
  });
  await plugin.preToolUse({
    executor: {
      harnessId: 'h1',
      teamContext: { teamId: JSON.parse(hugeTool.toolOutput).teamId, agentId: 'lead', leadId: 'lead' },
    },
    tool: invalidTool,
  });

  assert.equal(runCalls.length, 2);
  assert.equal(runCalls[0].maxTurns, 12);
  assert.equal(runCalls[1].maxTurns, 6);

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('send_team_message writes from lead by default and from teammate when team context exists', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.stateStore.createTeam({ harnessId: 'h1', teamId: 'team_1' });

  const leadTool = createTool('send_team_message', {
    teamId: 'team_1',
    to: 'reviewer',
    message: 'Please inspect the diff.',
  });

  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool: leadTool,
  });

  const teammateTool = createTool('send_team_message', {
    teamId: 'team_1',
    to: 'lead',
    message: 'I found a bug.',
  });

  await plugin.preToolUse({
    executor: {
      harnessId: 'h1',
      teamContext: { teamId: 'team_1', agentId: 'teammate_reviewer' },
    },
    tool: teammateTool,
  });

  const reviewerInbox = await fixture.bus.readInbox({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'reviewer',
  });
  const leadInbox = await fixture.bus.readInbox({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'lead',
  });

  assert.equal(reviewerInbox[0].from, 'lead');
  assert.equal(reviewerInbox[0].type, 'message');
  assert.equal(reviewerInbox[0].payload.message, 'Please inspect the diff.');
  assert.equal(leadInbox[0].from, 'teammate_reviewer');
  assert.equal(leadInbox[0].payload.message, 'I found a bug.');

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('check_team_inbox consumes the lead inbox and formats messages', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'teammate_reviewer',
    to: 'lead',
    type: 'result',
    payload: { content: 'Review complete.' },
  });

  const tool = createTool('check_team_inbox', { teamId: 'team_1' });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /teammate_reviewer/);
  assert.match(tool.toolOutput, /Review complete/);
  assert.deepEqual(
    await fixture.bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'lead' }),
    [],
  );

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('preLLM injects unread lead inbox into context once and consumes it', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'teammate_reviewer',
    to: 'lead',
    type: 'message',
    payload: { message: 'Need a decision.' },
  });

  const context = {
    executor: { harnessId: 'h1', runtimeRole: 'lead', teamContext: { teamId: 'team_1' } },
    apiMessages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }],
      },
    ],
  };

  await plugin.preLLM(context);

  const firstText = context.apiMessages[0].content[0].text;
  assert.match(firstText, /<team_inbox>/);
  assert.match(firstText, /Need a decision/);

  await plugin.preLLM(context);

  const secondText = context.apiMessages[0].content[0].text;
  assert.equal((secondText.match(/<team_inbox>/g) || []).length, 1);

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('preLLM injects teammate inbox using teamContext agentId and consumes it once', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'lead',
    to: 'teammate_reviewer',
    type: 'message',
    payload: { message: 'Please inspect commit 267ba6e.' },
  });

  const context = {
    executor: {
      harnessId: 'h1',
      runtimeRole: 'teammate',
      teamContext: { teamId: 'team_1', agentId: 'teammate_reviewer', leadId: 'lead' },
    },
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'Review the patch.' }] }],
  };

  await plugin.preLLM(context);

  const firstText = context.apiMessages[0].content[0].text;
  assert.match(firstText, /<team_inbox>/);
  assert.match(firstText, /Please inspect commit 267ba6e/);

  await plugin.preLLM(context);

  const secondText = context.apiMessages[0].content[0].text;
  assert.equal((secondText.match(/<team_inbox>/g) || []).length, 1);
  assert.deepEqual(
    await fixture.bus.peekInbox({
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'teammate_reviewer',
    }),
    [],
  );

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('persisted and reloaded lead teamContext lets a later executor inject lead inbox messages', async (t) => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  const originalCwd = process.cwd();
  const sessionRoot = await mkdtemp(path.join(tmpdir(), 'team-plugin-session-'));
  await mkdir(path.join(sessionRoot, 'server', 'sessions'), { recursive: true });
  process.chdir(sessionRoot);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(sessionRoot, { recursive: true, force: true });
    await rm(fixture.rootDir, { recursive: true, force: true });
  });

  const leadExecutor = new AgentExecutor({
    harnessId: 'h1',
    runtimeRole: 'lead',
    teamContext: { teamId: 'team_1', agentId: 'lead', leadId: 'lead' },
  });
  await leadExecutor.saveSession();

  await fixture.bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'teammate_reviewer',
    to: 'lead',
    type: 'result',
    payload: { content: 'Review complete.' },
  });

  const persistedSession = JSON.parse(
    await readFile(path.join(sessionRoot, 'server', 'sessions', 'h1.json'), 'utf-8'),
  );
  const laterExecutor = {
    harnessId: 'h1',
    runtimeRole: 'lead',
    teamContext: persistedSession.teamContext,
  };
  const context = {
    executor: laterExecutor,
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'Continue.' }] }],
  };

  await plugin.preLLM(context);

  assert.match(context.apiMessages[0].content[0].text, /<team_inbox>/);
  assert.match(context.apiMessages[0].content[0].text, /Review complete/);
});
