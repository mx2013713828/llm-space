import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';

import { SubAgentPlugin } from './SubAgentPlugin.js';
import { loadSubAgentTrace } from '../subagents/subAgentTraceStore.js';

test('sub-agent plugin spawns isolated one-off executor and returns the final assistant text', async () => {
  const spawned = {
    constructorArgs: null,
    ran: false,
    runMaxTurns: null,
  };

  class FakeExecutor {
    constructor(args) {
      spawned.constructorArgs = args;
      this.messages = [
        { role: 'assistant', type: 'text', content: 'First pass' },
        { role: 'assistant', type: 'text', content: 'Final report' },
      ];
    }

    async run(maxTurns) {
      spawned.ran = true;
      spawned.runMaxTurns = maxTurns;
      spawned.constructorArgs.onEvent('tool_exec_start', { id: 'child_tool', toolName: 'bash' });
    }
  }

  const parentEvents = [];
  const executor = {
    tools: ['bash', 'sub_agent', { name: 'schedule_cron' }, { name: 'custom_tool' }],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'todo',
        enable_sub_agents: true,
        enable_cron_scheduler: true,
      },
      enable_memory: {
        enabled: true,
      },
      security_mode: 'strict',
      enable_skills: true,
      context_compaction: {
        enabled: true,
      },
    },
    harnessId: 'subagent-plugin-test',
    model: { id: 'test-model' },
    temperature: 0.2,
    maxTokens: 1024,
    thinkingEnabled: false,
    runController: { mode: 'step_through' },
    skills: ['skill-a'],
    onEvent(type, payload) {
      parentEvents.push({ type, payload });
    },
  };
  const tool = {
    id: 'tool_123',
    toolName: 'sub_agent',
    toolInput: { prompt: 'Investigate the repository state.' },
  };

  await SubAgentPlugin.preToolUse({ executor, tool, ExecutorClass: FakeExecutor });

  assert.equal(spawned.ran, true);
  assert.equal(spawned.runMaxTurns, Number.POSITIVE_INFINITY);
  assert.deepEqual(spawned.constructorArgs.messages, [
    { role: 'user', content: 'Investigate the repository state.' },
  ]);
  assert.equal(spawned.constructorArgs.tools.some(entry => entry === 'sub_agent' || entry?.name === 'schedule_cron'), false);
  assert.deepEqual(spawned.constructorArgs.tools, ['bash', { name: 'custom_tool' }, 'get_current_time']);
  assert.equal(spawned.constructorArgs.features.task_orchestration.enabled, false);
  assert.equal(spawned.constructorArgs.features.enable_memory.enabled, false);
  assert.equal(spawned.constructorArgs.features.security_mode, 'strict');
  assert.deepEqual(spawned.constructorArgs.skills, ['skill-a']);
  assert.equal(spawned.constructorArgs.runController, undefined);
  assert.match(spawned.constructorArgs.systemPrompt, /forbidden to delegate/i);
  assert.deepEqual(parentEvents, [
    {
      type: 'sub_agent_status',
      payload: {
        id: 'tool_123',
        status: 'running',
        phase: 'starting',
        currentAction: 'Investigate the repository state.',
        toolCount: 0,
        previewTruncated: false,
        startedAt: parentEvents[0].payload.startedAt,
        parentToolCallId: 'tool_123',
      },
    },
    {
      type: 'sub_agent_status',
      payload: {
        id: 'tool_123',
        status: 'running',
        phase: 'tool_use',
        currentAction: 'executing bash',
        currentTool: 'bash',
        toolCount: 0,
        previewTruncated: false,
        startedAt: parentEvents[1].payload.startedAt,
        parentToolCallId: 'tool_123',
      },
    },
    {
      type: 'sub_agent_trace_ready',
      payload: {
        id: 'tool_123',
        status: 'completed',
        phase: 'completed',
        currentAction: 'completed',
        finalPreview: 'Final report',
        trace: parentEvents[2].payload.trace,
        toolCount: 0,
        startedAt: parentEvents[2].payload.startedAt,
        completedAt: parentEvents[2].payload.completedAt,
        parentToolCallId: 'tool_123',
      },
    },
  ]);
  assert.equal(parentEvents[2].payload.trace.traceId, 'tool_123');
  assert.equal(tool.toolOutput, 'Final report');
  assert.equal(tool.subAgentTrace.traceId, 'tool_123');
  assert.equal(tool.handled, true);

  const trace = await loadSubAgentTrace('subagent-plugin-test', 'tool_123');
  assert.equal(trace.finalAnswer, 'Final report');
  assert.equal(trace.summary.messageCount, 2);

  await rm(path.join(process.cwd(), 'server', 'sessions', 'subagent-plugin-test_subagents'), { recursive: true, force: true });
});

test('sub-agent plugin falls back when child returns no final assistant text', async () => {
  class FakeExecutor {
    constructor() {
      this.messages = [
        { role: 'assistant', type: 'thinking', content: 'working' },
        { role: 'assistant', type: 'text', content: '   ' },
      ];
    }

    async run() {}
  }

  const tool = {
    id: 'tool_empty',
    toolName: 'sub_agent',
    toolInput: { prompt: 'Do the work.' },
  };

  await SubAgentPlugin.preToolUse({
    executor: {
      harnessId: 'subagent-empty-test',
      tools: ['bash'],
      features: {},
      model: {},
      temperature: 0,
      maxTokens: 256,
      thinkingEnabled: false,
      skills: [],
      onEvent() {},
    },
    tool,
    ExecutorClass: FakeExecutor,
  });

  assert.equal(tool.toolOutput, '(子代理运行完毕，未返回任何文字总结)');
  assert.equal(tool.handled, true);

  await rm(path.join(process.cwd(), 'server', 'sessions', 'subagent-empty-test_subagents'), { recursive: true, force: true });
});

test('sub-agent plugin converts child executor errors into tool output', async () => {
  class FakeExecutor {
    constructor() {
      this.messages = [];
    }

    async run() {
      throw new Error('child exploded');
    }
  }

  const tool = {
    id: 'tool_fail',
    toolName: 'sub_agent',
    toolInput: { prompt: 'Trigger an error.' },
  };
  const parentEvents = [];

  await SubAgentPlugin.preToolUse({
    executor: {
      harnessId: 'subagent-fail-test',
      tools: ['bash'],
      features: {},
      model: {},
      temperature: 0,
      maxTokens: 256,
      thinkingEnabled: false,
      skills: [],
      onEvent(type, payload) {
        parentEvents.push({ type, payload });
      },
    },
    tool,
    ExecutorClass: FakeExecutor,
  });

  assert.equal(tool.toolOutput, '[子代理异常崩溃]\nchild exploded');
  assert.ok(parentEvents.some(event => event.type === 'sub_agent_trace_ready' && event.payload.status === 'failed'));
  assert.equal(tool.handled, true);

  await rm(path.join(process.cwd(), 'server', 'sessions', 'subagent-fail-test_subagents'), { recursive: true, force: true });
});

test('sub-agent plugin forwards only bounded child trajectory previews', async () => {
  class FakeExecutor {
    constructor(args) {
      this.args = args;
      this.messages = [
        { role: 'assistant', type: 'text', content: 'Final report remains available' },
      ];
    }

    async run() {
      this.args.onEvent('messages_update', { messages: [{ type: 'text', content: 'hidden full update' }] });
      this.args.onEvent('text_start', { turn: 1 });
      this.args.onEvent('text_delta', { text: 'streamed child text that should not enter parent messages' });
      this.args.onEvent('tool_start', { id: 'child_tool', name: 'bash' });
      this.args.onEvent('tool_exec_done', { id: 'child_tool', output: 'large child output stored in trace only' });
    }
  }

  const parentEvents = [];
  const tool = {
    id: 'tool_huge',
    toolName: 'sub_agent',
    toolInput: { prompt: 'Produce a huge result.' },
  };

  await SubAgentPlugin.preToolUse({
    executor: {
      harnessId: 'subagent-preview-test',
      tools: ['bash'],
      features: {},
      model: {},
      temperature: 0,
      maxTokens: 256,
      thinkingEnabled: false,
      skills: [],
      onEvent(type, payload) {
        parentEvents.push({ type, payload });
      },
    },
    tool,
    ExecutorClass: FakeExecutor,
  });

  assert.equal(parentEvents.some(event => event.type === 'messages_update'), false);
  assert.equal(parentEvents.some(event => event.type === 'text_delta'), false);
  assert.equal(parentEvents.some(event => event.type === 'tool_exec_done'), false);
  assert.ok(parentEvents.some(event => event.type === 'sub_agent_status' && event.payload.phase === 'tool_use'));
  assert.ok(parentEvents.some(event => event.type === 'sub_agent_trace_ready'));
  assert.equal(tool.toolOutput, 'Final report remains available');

  await rm(path.join(process.cwd(), 'server', 'sessions', 'subagent-preview-test_subagents'), { recursive: true, force: true });
});
