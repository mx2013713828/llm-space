import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { AgentExecutor } from './AgentExecutor.js';
import { SecurityPlugin } from './plugins/SecurityPlugin.js';

async function withTempCwd(prefix, fn) {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), prefix));
  await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
  process.chdir(rootDir);
  try {
    return await fn(rootDir);
  } finally {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('run executes pending tool calls from current messages even when provider stop reason is not tool_use', async () => {
  await withTempCwd('agent-loop-stage-tool-blocks-', async () => {
    const executor = new AgentExecutor({
      harnessId: 'tool-blocks-drive-loop',
      messages: [{ role: 'user', turn: 1, content: 'What time is it?' }],
      tools: ['get_current_time'],
      model: { id: 'test', modelId: 'test-model', key: 'test', url: 'https://api.example.test' },
      onEvent() {},
    });

    let calls = 0;
    executor._callLLM = async (context) => {
      calls += 1;
      if (calls === 1) {
        executor.messages.push({
          role: 'assistant',
          type: 'tool_call',
          turn: context.turnIndex,
          id: 'toolu_time',
          toolName: 'get_current_time',
          toolInput: {},
          toolStatus: 'pending',
        });
        return 'end_turn';
      }

      executor.messages.push({
        role: 'assistant',
        type: 'text',
        turn: context.turnIndex,
        content: 'Final answer after the time tool.',
      });
      return 'end_turn';
    };

    await executor.run(2);

    const toolCall = executor.messages.find(message => message.id === 'toolu_time');
    const finalText = executor.messages.find(message => message.content === 'Final answer after the time tool.');

    assert.equal(calls, 2);
    assert.equal(toolCall.toolStatus, 'completed');
    const timeOutput = JSON.parse(toolCall.toolOutput);
    assert.equal(typeof timeOutput.date, 'string');
    assert.equal(typeof timeOutput.time, 'string');
    assert.equal(typeof timeOutput.timezone, 'string');
    assert.ok(finalText);
  });
});

test('run emits done cleanup after a normal final answer', async () => {
  await withTempCwd('agent-loop-stage-normal-cleanup-', async () => {
    const events = [];
    const executor = new AgentExecutor({
      harnessId: 'normal-cleanup',
      messages: [{ role: 'user', turn: 1, content: 'Hello' }],
      tools: [],
      model: { id: 'test', modelId: 'test-model', key: 'test', url: 'https://api.example.test' },
      onEvent(type, payload) {
        events.push({ type, payload });
      },
    });

    executor._callLLM = async (context) => {
      executor.messages.push({
        role: 'assistant',
        type: 'text',
        turn: context.turnIndex,
        content: 'Final answer.',
      });
      return 'end_turn';
    };

    await executor.run(1);

    assert.equal(events.some(event => event.type === 'done'), true);
  });
});

test('run emits error and done cleanup when the model stage throws', async () => {
  await withTempCwd('agent-loop-stage-error-cleanup-', async () => {
    const originalConsoleError = console.error;
    const events = [];
    const executor = new AgentExecutor({
      harnessId: 'error-cleanup',
      messages: [{ role: 'user', turn: 1, content: 'Hello' }],
      tools: [],
      model: { id: 'test', modelId: 'test-model', key: 'test', url: 'https://api.example.test' },
      onEvent(type, payload) {
        events.push({ type, payload });
      },
    });

    executor._callLLM = async () => {
      throw new Error('model exploded');
    };

    console.error = () => {};
    try {
      await executor.run(1);
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(events.some(event => event.type === 'error' && event.payload.message === 'model exploded'), true);
    assert.equal(events.at(-1).type, 'done');
  });
});

test('run emits done cleanup after a permanent security block stops the loop', async () => {
  await withTempCwd('agent-loop-stage-security-cleanup-', async () => {
    const events = [];
    const executor = new AgentExecutor({
      harnessId: 'security-cleanup',
      messages: [{ role: 'user', turn: 1, content: '读取.env文件看看' }],
      tools: ['bash'],
      model: { id: 'test', modelId: 'test-model', key: 'test', url: 'https://api.example.test' },
      features: { security_mode: 'relaxed' },
      onEvent(type, payload) {
        events.push({ type, payload });
      },
    });

    executor._callLLM = async (context) => {
      executor.messages.push({
        role: 'assistant',
        type: 'tool_call',
        turn: context.turnIndex,
        id: 'toolu_env',
        toolName: 'bash',
        toolInput: { command: `python -c "print(open('.env').read())"` },
        toolStatus: 'pending',
      });
      return 'tool_use';
    };

    await executor.run(5);

    assert.equal(events.some(event => event.type === 'tool_exec_done'), true);
    assert.equal(events.at(-1).type, 'done');
  });
});

test('run stop cleanup clears pending security permission requests', async () => {
  await withTempCwd('agent-loop-stage-permission-cleanup-', async () => {
    const events = [];
    const executor = new AgentExecutor({
      harnessId: 'permission-cleanup',
      messages: [{ role: 'user', turn: 1, content: 'Hello' }],
      tools: [],
      model: { id: 'test', modelId: 'test-model', key: 'test', url: 'https://api.example.test' },
      onEvent(type, payload) {
        events.push({ type, payload });
      },
    });

    let resolvedDecision = null;
    const timeoutId = setTimeout(() => {}, 60_000);
    SecurityPlugin.pendingRequests.set('toolu_pending_permission', {
      executor,
      timeoutId,
      resolve(decision) {
        resolvedDecision = decision;
      },
    });

    executor._callLLM = async (context) => {
      executor.messages.push({
        role: 'assistant',
        type: 'text',
        turn: context.turnIndex,
        content: 'Final answer.',
      });
      return 'end_turn';
    };

    await executor.run(1);

    assert.equal(SecurityPlugin.pendingRequests.has('toolu_pending_permission'), false);
    assert.equal(resolvedDecision, 'deny');
    assert.equal(events.at(-1).type, 'done');
  });
});
