import test from 'node:test';
import assert from 'node:assert/strict';

import { SubAgentPlugin } from './SubAgentPlugin.js';

test('sub-agent plugin spawns isolated one-off executor and returns the final assistant text', async () => {
  const spawned = {
    constructorArgs: null,
    ran: false,
  };

  class FakeExecutor {
    constructor(args) {
      spawned.constructorArgs = args;
      this.messages = [
        { role: 'assistant', type: 'text', content: 'First pass' },
        { role: 'assistant', type: 'text', content: 'Final report' },
      ];
    }

    async run() {
      spawned.ran = true;
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
    model: { id: 'test-model' },
    temperature: 0.2,
    maxTokens: 1024,
    thinkingEnabled: false,
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
  assert.deepEqual(spawned.constructorArgs.messages, [
    { role: 'user', content: 'Investigate the repository state.' },
  ]);
  assert.equal(spawned.constructorArgs.tools.some(entry => entry === 'sub_agent' || entry?.name === 'schedule_cron'), false);
  assert.deepEqual(spawned.constructorArgs.tools, ['bash', { name: 'custom_tool' }]);
  assert.equal(spawned.constructorArgs.features.task_orchestration.enabled, false);
  assert.equal(spawned.constructorArgs.features.enable_memory.enabled, false);
  assert.equal(spawned.constructorArgs.features.security_mode, 'strict');
  assert.deepEqual(spawned.constructorArgs.skills, ['skill-a']);
  assert.match(spawned.constructorArgs.systemPrompt, /forbidden to delegate/i);
  assert.deepEqual(parentEvents, [
    {
      type: 'tool_exec_start',
      payload: {
        id: 'child_tool',
        toolName: 'bash',
        parentToolCallId: 'tool_123',
      },
    },
  ]);
  assert.equal(tool.toolOutput, 'Final report');
  assert.equal(tool.handled, true);
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

  await SubAgentPlugin.preToolUse({
    executor: {
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

  assert.equal(tool.toolOutput, '[子代理异常崩溃]\nchild exploded');
  assert.equal(tool.handled, true);
});
