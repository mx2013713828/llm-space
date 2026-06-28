import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

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
  const events = [];
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
    executor: { harnessId: 'h1', teamContext: null, onEvent: (type, payload) => events.push({ type, payload }) },
    tool,
  });

  assert.equal(tool.handled, true);
  const output = JSON.parse(tool.toolOutput);
  assert.equal(output.status, 'running');
  assert.equal(output.teammateId, 'teammate_reviewer');
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].parentExecutor.teamContext.harnessId, 'h1');

  const state = await fixture.stateStore.loadState({
    harnessId: 'h1',
    teamId: output.teamId,
  });
  assert.equal(state.teamId, output.teamId);
  assert.equal(state.teammates.teammate_reviewer.agentId, 'teammate_reviewer');
  assert.equal(state.teammates.teammate_reviewer.role, 'Critic');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'team_update');
  assert.equal(events[0].payload.teamId, output.teamId);
  assert.deepEqual(
    {
      agentId: events[0].payload.teammates[0].agentId,
      name: events[0].payload.teammates[0].name,
      role: events[0].payload.teammates[0].role,
      state: events[0].payload.teammates[0].state,
      prompt: events[0].payload.teammates[0].prompt,
    },
    {
      agentId: 'teammate_reviewer',
      name: 'reviewer',
      role: 'Critic',
      state: 'running',
      prompt: 'Review the patch.',
    },
  );
  assert.match(events[0].payload.teammates[0].startedAt, /^\d{4}-/);

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
  assert.equal(runCalls[0].maxTurns, 24);
  assert.equal(runCalls[1].maxTurns, 8);

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('spawn_teammate accepts structured brief fields and builds a standard teammate prompt', async () => {
  const fixture = await createFixture();
  const runCalls = [];
  const events = [];
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn(input) {
      runCalls.push(input);
    },
  });

  const tool = createTool('spawn_teammate', {
    name: 'backend',
    role: 'Backend reviewer',
    objective: 'Review the team orchestration backend changes.',
    constraints: 'Do not modify files. Focus on correctness risks.',
    expected_output: 'Return critical findings with file references.',
    success_criteria: 'Mention if no blocking issues are found.',
    maxTurns: 5,
  });

  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null, onEvent: (type, payload) => events.push({ type, payload }) },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.equal(runCalls.length, 1);
  assert.match(runCalls[0].initialPrompt, /<teammate_brief>/);
  assert.match(runCalls[0].initialPrompt, /Objective:\nReview the team orchestration backend changes\./);
  assert.match(runCalls[0].initialPrompt, /Constraints:\nDo not modify files\. Focus on correctness risks\./);
  assert.match(runCalls[0].initialPrompt, /Expected output:\nReturn critical findings with file references\./);
  assert.match(runCalls[0].initialPrompt, /Success criteria:\nMention if no blocking issues are found\./);

  const output = JSON.parse(tool.toolOutput);
  const state = await fixture.stateStore.loadState({
    harnessId: 'h1',
    teamId: output.teamId,
  });
  assert.equal(state.teammates.teammate_backend.brief.objective, 'Review the team orchestration backend changes.');
  assert.equal(state.teammates.teammate_backend.prompt, runCalls[0].initialPrompt);
  assert.equal(events[0].payload.teammates[0].brief.objective, 'Review the team orchestration backend changes.');

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('parallel spawn_teammate calls in one turn share a single team', async () => {
  const fixture = await createFixture();
  const runCalls = [];
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn(input) {
      runCalls.push(input);
    },
  });
  const executor = { harnessId: 'h1', teamContext: null };
  const tools = [
    createTool('spawn_teammate', { name: 'backend', prompt: 'Review backend.' }),
    createTool('spawn_teammate', { name: 'frontend', prompt: 'Review frontend.' }),
    createTool('spawn_teammate', { name: 'tests', prompt: 'Review tests.' }),
  ];

  await Promise.all(tools.map(tool => plugin.preToolUse({ executor, tool })));

  const outputs = tools.map(tool => JSON.parse(tool.toolOutput));
  const teamIds = new Set(outputs.map(output => output.teamId));
  assert.equal(teamIds.size, 1);
  assert.equal(runCalls.length, 3);
  assert.deepEqual(new Set(runCalls.map(call => call.teamId)), teamIds);

  const state = await fixture.stateStore.loadState({
    harnessId: 'h1',
    teamId: outputs[0].teamId,
  });
  assert.deepEqual(
    Object.keys(state.teammates).sort(),
    ['teammate_backend', 'teammate_frontend', 'teammate_tests'].sort(),
  );

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

test('teammate team tools use the parent team harness even when child harness is isolated', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.stateStore.createTeam({ harnessId: 'parent_harness', teamId: 'team_1' });
  await fixture.bus.sendMessage({
    harnessId: 'parent_harness',
    teamId: 'team_1',
    from: 'lead',
    to: 'teammate_reviewer',
    type: 'message',
    payload: { message: 'Use the parent inbox.' },
  });

  const context = {
    executor: {
      harnessId: 'parent_harness_teammate_reviewer',
      runtimeRole: 'teammate',
      teamContext: {
        harnessId: 'parent_harness',
        teamId: 'team_1',
        agentId: 'teammate_reviewer',
        leadId: 'lead',
      },
    },
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'Continue.' }] }],
  };

  await plugin.preLLM(context);

  assert.match(context.apiMessages[0].content[0].text, /Use the parent inbox/);

  const replyTool = createTool('send_team_message', {
    teamId: 'team_1',
    to: 'lead',
    message: 'Done.',
  });
  await plugin.preToolUse({ executor: context.executor, tool: replyTool });

  const leadInbox = await fixture.bus.readInbox({
    harnessId: 'parent_harness',
    teamId: 'team_1',
    agentId: 'lead',
  });
  assert.equal(leadInbox[0].payload.message, 'Done.');

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
  await fixture.stateStore.createTeam({
    harnessId: 'h1',
    teamId: 'team_1',
    teammates: [
      { agentId: 'teammate_reviewer', name: 'reviewer', state: 'completed' },
      { agentId: 'teammate_backend', name: 'backend', state: 'running' },
      { agentId: 'teammate_tests', name: 'tests', state: 'turn_limit', error: 'max turns exhausted' },
    ],
  });

  const tool = createTool('check_team_inbox', { teamId: 'team_1' });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /teammate_reviewer/);
  assert.match(tool.toolOutput, /Review complete/);
  assert.match(tool.toolOutput, /Team status/);
  assert.match(tool.toolOutput, /backend: running/);
  assert.match(tool.toolOutput, /tests: turn_limit/);
  assert.match(tool.toolOutput, /Do not give a final answer as if all teammates completed/);
  assert.deepEqual(
    await fixture.bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'lead' }),
    [],
  );

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('check_team_inbox bounds large inbox output', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    outputRootDir: fixture.rootDir,
    async runTeammateFn() {},
  });
  const largeReport = `INBOX_START\n${'large inbox line\n'.repeat(500)}INBOX_END`;

  await fixture.bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'teammate_reviewer',
    to: 'lead',
    type: 'result',
    payload: { content: largeReport },
  });
  await fixture.stateStore.createTeam({
    harnessId: 'h1',
    teamId: 'team_1',
    teammates: [
      { agentId: 'teammate_reviewer', name: 'reviewer', state: 'completed' },
    ],
  });

  const tool = createTool('check_team_inbox', { teamId: 'team_1' });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.equal(tool.toolOutput.includes('INBOX_END'), false);
  assert.match(tool.toolOutput, /Full team inbox offloaded/);
  assert.ok(tool.toolOutput.length < 5000);

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('wait_for_teammates waits for terminal states without consuming inbox results', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.stateStore.createTeam({
    harnessId: 'h1',
    teamId: 'team_1',
    teammates: [
      { agentId: 'teammate_reviewer', name: 'reviewer', state: 'running' },
    ],
  });

  setTimeout(async () => {
    await fixture.stateStore.updateTeammate({
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'teammate_reviewer',
      updates: { state: 'completed', lastResult: 'Looks good.' },
    });
    await fixture.bus.sendMessage({
      harnessId: 'h1',
      teamId: 'team_1',
      from: 'teammate_reviewer',
      to: 'lead',
      type: 'result',
      payload: { content: 'Looks good.' },
    });
  }, 20);

  const tool = createTool('wait_for_teammates', {
    teamId: 'team_1',
    timeoutMs: 500,
    pollIntervalMs: 10,
  });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /All teammates reached terminal states/);
  assert.match(tool.toolOutput, /reviewer: completed/);
  assert.match(tool.toolOutput, /Unread lead inbox messages: 1/);
  assert.match(tool.toolOutput, /Call check_team_inbox to read teammate results/);
  assert.doesNotMatch(tool.toolOutput, /Looks good/);
  const unreadAfterWait = await fixture.bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'lead' });
  assert.equal(unreadAfterWait.length, 1);
  assert.equal(unreadAfterWait[0].from, 'teammate_reviewer');

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('wait_for_teammates only reports unread count for large inbox output', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    outputRootDir: fixture.rootDir,
    async runTeammateFn() {},
  });
  const largeReport = `REPORT_START\n${'large teammate finding\n'.repeat(500)}REPORT_END`;

  await fixture.stateStore.createTeam({
    harnessId: 'h1',
    teamId: 'team_1',
    teammates: [
      { agentId: 'teammate_reviewer', name: 'reviewer', state: 'completed', lastResult: largeReport },
    ],
  });
  await fixture.bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'teammate_reviewer',
    to: 'lead',
    type: 'result',
    payload: { content: largeReport },
  });

  const tool = createTool('wait_for_teammates', {
    teamId: 'team_1',
    timeoutMs: 10,
    pollIntervalMs: 5,
  });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.equal(tool.toolOutput.includes('REPORT_END'), false);
  assert.match(tool.toolOutput, /Unread lead inbox messages: 1/);
  assert.doesNotMatch(tool.toolOutput, /Full team inbox offloaded/);
  assert.ok(tool.toolOutput.length < 5000);
  assert.equal(
    (await fixture.bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'lead' })).length,
    1,
  );

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('wait_for_teammates times out with unresolved status', async () => {
  const fixture = await createFixture();
  const plugin = createTeamPlugin({
    bus: fixture.bus,
    stateStore: fixture.stateStore,
    async runTeammateFn() {},
  });

  await fixture.stateStore.createTeam({
    harnessId: 'h1',
    teamId: 'team_1',
    teammates: [
      { agentId: 'teammate_backend', name: 'backend', state: 'running' },
    ],
  });

  const tool = createTool('wait_for_teammates', {
    teamId: 'team_1',
    timeoutMs: 25,
    pollIntervalMs: 5,
  });
  await plugin.preToolUse({
    executor: { harnessId: 'h1', teamContext: null },
    tool,
  });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /Timed out waiting for teammates/);
  assert.match(tool.toolOutput, /backend: running/);
  assert.match(tool.toolOutput, /Do not give a final answer as if all teammates completed/);

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('preLLM asks async team leads to call check_team_inbox without consuming inbox', async () => {
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
    executor: {
      harnessId: 'h1',
      runtimeRole: 'lead',
      selectedStrategyId: 'async_teams',
      teamContext: { teamId: 'team_1' },
    },
    apiMessages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'Continue.' }],
      },
    ],
  };

  await plugin.preLLM(context);

  const firstText = context.apiMessages[0].content[0].text;
  assert.match(firstText, /<team_protocol_guard>/);
  assert.match(firstText, /must call check_team_inbox/);
  assert.doesNotMatch(firstText, /Need a decision/);
  assert.equal(
    (await fixture.bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'lead' })).length,
    1,
  );

  await plugin.preLLM(context);

  const secondText = context.apiMessages[0].content[0].text;
  assert.equal((secondText.match(/<team_protocol_guard>/g) || []).length, 1);
  assert.equal(
    (await fixture.bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'lead' })).length,
    1,
  );

  await rm(fixture.rootDir, { recursive: true, force: true });
});

test('preLLM auto-injects lead inbox outside async teams and emits an observable event', async () => {
  const fixture = await createFixture();
  const events = [];
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
    executor: {
      harnessId: 'h1',
      runtimeRole: 'lead',
      selectedStrategyId: 'custom',
      teamContext: { teamId: 'team_1' },
      onEvent: (type, payload) => events.push({ type, payload }),
    },
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'Continue.' }] }],
  };

  await plugin.preLLM(context);

  const firstText = context.apiMessages[0].content[0].text;
  assert.match(firstText, /<team_inbox>/);
  assert.match(firstText, /Need a decision/);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'team_inbox_auto_injected');
  assert.equal(events[0].payload.messageCount, 1);
  assert.equal(events[0].payload.agentId, 'lead');

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
      harnessId: 'h1_teammate_reviewer',
      runtimeRole: 'teammate',
      teamContext: {
        harnessId: 'h1',
        teamId: 'team_1',
        agentId: 'teammate_reviewer',
        leadId: 'lead',
      },
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
