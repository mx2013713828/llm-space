import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { AgentExecutor } from '../AgentExecutor.js';
import { runTeammate } from '../teams/teammateRunner.js';

function sseResponse(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\n`).join('\n')));
      controller.close();
    },
  });
  return { ok: true, body };
}

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

test('trace-inspection questions send no tool schemas to the model', async (t) => {
  await withTempCwd('runtime-no-tools-', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    t.after(() => {
      globalThis.fetch = originalFetch;
    });
    globalThis.fetch = async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return sseResponse([
        { type: 'message_start', message: { model: 'test', usage: { input_tokens: 10 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'No new tools used.' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
      ]);
    };

    const executor = new AgentExecutor({
      harnessId: 'trace-inspection',
      messages: [{ role: 'user', turn: 1, content: '你刚才为什么要调用 read_file？' }],
      tools: ['read_file'],
      model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    });

    await executor.run(1);

    assert.equal(requests.length, 1);
    assert.equal('tools' in requests[0], false);
  });
});

test('empty read_file tool calls are marked invalid without executing the tool', async () => {
  await withTempCwd('runtime-invalid-tool-', async () => {
    const executor = new AgentExecutor({
      harnessId: 'invalid-tool',
      messages: [{ role: 'user', turn: 1, content: 'Read a file.' }],
      tools: ['read_file'],
      model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    });

    let calls = 0;
    executor._callLLM = async (context) => {
      calls += 1;
      if (calls === 1) {
        executor.messages.push({
          role: 'assistant',
          type: 'tool_call',
          turn: context.turnIndex,
          id: 'toolu_read',
          toolName: 'read_file',
          toolInput: {},
        });
        return 'tool_use';
      }

      executor.messages.push({
        role: 'assistant',
        type: 'text',
        turn: context.turnIndex,
        content: 'Final answer from invalid tool state.',
      });
      return 'end_turn';
    };

    await executor.run(1);

    const toolCall = executor.messages.find(message => message.id === 'toolu_read');
    assert.equal(toolCall.toolStatus, 'invalid_args');
    assert.match(toolCall.toolOutput, /requires parameter "path"/);
    assert.equal(calls, 2);
  });
});

test('permanent security blocks stop the loop instead of retrying bypass attempts', async () => {
  await withTempCwd('runtime-security-block-', async () => {
    const executor = new AgentExecutor({
      harnessId: 'security-block',
      messages: [{ role: 'user', turn: 1, content: '读取.env文件看看' }],
      tools: ['bash', 'read_file', 'sub_agent'],
      model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
      features: { security_mode: 'relaxed' },
    });

    let calls = 0;
    executor._callLLM = async (context) => {
      calls += 1;
      executor.messages.push({
        role: 'assistant',
        type: 'tool_call',
        turn: context.turnIndex,
        id: `toolu_env_${calls}`,
        toolName: 'bash',
        toolInput: { command: `python -c "print(open('.env').read())"` },
      });
      return 'tool_use';
    };

    await executor.run(5);

    const blockedTool = executor.messages.find(message => message.id === 'toolu_env_1');
    const finalText = executor.messages.findLast(message => message.role === 'assistant' && message.type === 'text');

    assert.equal(calls, 1);
    assert.equal(blockedTool.toolStatus, 'blocked');
    assert.match(finalText.content, /敏感文件|security policy|安全策略/i);
    assert.match(finalText.content, /不能|无法|blocked|cannot/i);
  });
});

test('sensitive read_file denials stop the loop before bash fallback attempts', async () => {
  await withTempCwd('runtime-readfile-security-block-', async () => {
    const executor = new AgentExecutor({
      harnessId: 'readfile-security-block',
      messages: [{ role: 'user', turn: 1, content: '读取.env文件看看' }],
      tools: ['read_file', 'bash'],
      model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
      features: { security_mode: 'relaxed' },
    });

    let calls = 0;
    executor._callLLM = async (context) => {
      calls += 1;
      executor.messages.push({
        role: 'assistant',
        type: 'tool_call',
        turn: context.turnIndex,
        id: `toolu_read_env_${calls}`,
        toolName: calls === 1 ? 'read_file' : 'bash',
        toolInput: calls === 1
          ? { path: '.env' }
          : { command: `python -c "print(open('.env').read())"` },
      });
      return 'tool_use';
    };

    await executor.run(5);

    const blockedTool = executor.messages.find(message => message.id === 'toolu_read_env_1');

    assert.equal(calls, 1);
    assert.equal(blockedTool.toolStatus, 'blocked');
    assert.equal(executor.messages.some(message => message.id === 'toolu_read_env_2'), false);
  });
});

test('teammate with only a final tool call sends an error outcome to lead', async () => {
  await withTempCwd('runtime-teammate-no-result-', async () => {
    class ToolOnlyExecutor {
      constructor(args) {
        ToolOnlyExecutor.lastArgs = args;
        this.messages = [
          { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
        ];
      }

      async run() {}
    }

    const sentMessages = [];
    await runTeammate({
      parentExecutor: {
        harnessId: 'h1',
        tools: ['read_file', 'spawn_teammate', 'send_team_message'],
        features: {
          task_orchestration: {
            enabled: true,
            mode: 'todo',
            enable_agent_teams: true,
          },
          enable_memory: { enabled: true },
        },
        model: { modelId: 'test' },
        temperature: 0,
        maxTokens: 1000,
        thinkingEnabled: false,
        skills: [],
        onEvent() {},
      },
      teamId: 'team_1',
      teammateId: 'frontend',
      name: 'frontend',
      role: 'Frontend reviewer',
      initialPrompt: 'Review frontend.',
      ExecutorClass: ToolOnlyExecutor,
      stateStore: {
        async updateTeammate() {},
      },
      bus: {
        async sendMessage(message) {
          sentMessages.push(message);
        },
      },
    });

    assert.equal(sentMessages[0].type, 'error');
    assert.equal(sentMessages[0].payload.status, 'no_result');
    assert.match(sentMessages[0].payload.error, /final text report/i);
  });
});
