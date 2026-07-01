import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AgentExecutor } from './AgentExecutor.js';

function sseResponse(events) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(events.map(event => `data: ${JSON.stringify(event)}\n`).join('\n')));
      controller.close();
    }
  });
  return { ok: true, body };
}

test('stores a text block separately after a thinking block', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need weather.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'It is cloudy.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }
  ]);

  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    thinkingEnabled: true
  });

  await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'weather' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: []
  }, { continuation_tokens: [] });

  assert.deepEqual(executor.messages.map(({ type, content }) => ({ type, content })), [
    { type: 'thinking', content: 'Need weather.' },
    { type: 'text', content: 'It is cloudy.' }
  ]);
});

test('emits stable ids for streamed assistant content blocks', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Plan.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Answer.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } }
  ]);
  const emittedEvents = [];
  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    thinkingEnabled: true,
    onEvent: (type, payload) => emittedEvents.push({ type, payload }),
  });

  await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'review' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: []
  }, { continuation_tokens: [] });

  const thinkingStart = emittedEvents.find(event => event.type === 'thinking_start');
  const thinkingDelta = emittedEvents.find(event => event.type === 'thinking_delta');
  const textStart = emittedEvents.find(event => event.type === 'text_start');
  const textDelta = emittedEvents.find(event => event.type === 'text_delta');

  assert.equal(thinkingStart.payload.id, 'msg_1_0_thinking');
  assert.equal(thinkingDelta.payload.id, thinkingStart.payload.id);
  assert.equal(textStart.payload.id, 'msg_1_1_text');
  assert.equal(textDelta.payload.id, textStart.payload.id);
  assert.deepEqual(executor.messages.map(({ id }) => id), ['msg_1_0_thinking', 'msg_1_1_text']);
});

test('tracks interleaved streamed content blocks by provider index', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_weather', name: 'weather_report' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"city"' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking weather.' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"Linyi"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }
  ]);
  const emittedEvents = [];
  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    thinkingEnabled: true,
    onEvent: (type, payload) => emittedEvents.push({ type, payload }),
  });

  const stopReason = await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'weather' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: ['weather_report']
  }, { continuation_tokens: [] });

  assert.equal(stopReason, 'tool_use');
  assert.deepEqual(executor.messages.map(({ type, content, toolName, toolInput }) => ({
    type,
    content,
    toolName,
    toolInput,
  })), [
    {
      type: 'text',
      content: 'Checking weather.',
      toolName: undefined,
      toolInput: undefined,
    },
    {
      type: 'tool_call',
      content: undefined,
      toolName: 'weather_report',
      toolInput: { city: 'Linyi' },
    },
  ]);
  assert.equal(emittedEvents.filter(event => event.type === 'text_start').length, 1);
  assert.equal(emittedEvents.filter(event => event.type === 'tool_start').length, 1);
  assert.equal(emittedEvents.find(event => event.type === 'tool_end')?.payload.id, 'toolu_weather');
});

test('recovers when a provider sends text_delta without starting a text block', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '[Thinking folded] response' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Weather report.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }
  ]);
  const emittedEvents = [];
  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    thinkingEnabled: true,
    onEvent: (type) => emittedEvents.push(type)
  });

  await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'weather' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: []
  }, { continuation_tokens: [] });

  assert.deepEqual(executor.messages.map(({ type, content }) => ({ type, content })), [
    { type: 'thinking', content: '[Thinking folded] response' },
    { type: 'text', content: 'Weather report.' }
  ]);
  assert.equal(emittedEvents.filter(type => type === 'text_start').length, 1);
});

test('promotes a folded-thinking response when the provider ends without text', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '[Thinking folded] responseWeather report.' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } }
  ]);
  const emittedEvents = [];
  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    thinkingEnabled: true,
    onEvent: (type) => emittedEvents.push(type)
  });

  await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'weather' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: []
  }, { continuation_tokens: [] });

  assert.deepEqual(executor.messages.map(({ type, content }) => ({ type, content })), [
    { type: 'thinking', content: '[Thinking folded]' },
    { type: 'text', content: 'Weather report.' }
  ]);
  assert.equal(emittedEvents.includes('messages_update'), true);
});

test('non-stream summary calls do not inherit Anthropic thinking mode', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    requests.push({
      headers: options.headers,
      body: JSON.parse(options.body),
    });
    return {
      ok: true,
      async json() {
        return { content: [{ type: 'text', text: '<summary>done</summary>' }] };
      },
    };
  };

  const executor = new AgentExecutor({
    model: { id: 'anthropic', modelId: 'claude-sonnet-4-5', key: 'test', url: 'https://api.anthropic.com' },
    thinkingEnabled: true,
  });

  const summary = await executor._callLLMNonStream(
    [{ role: 'user', content: [{ type: 'text', text: 'Summarize.' }] }],
    'summary prompt',
  );

  assert.equal(summary, '<summary>done</summary>');
  assert.equal('thinking' in requests[0].body, false);
  assert.equal('anthropic-beta' in requests[0].headers, false);
});

test('DeepSeek model hints use DeepSeek request semantics even through a proxy URL', async (t) => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options) => {
    requests.push({
      headers: options.headers,
      body: JSON.parse(options.body),
    });
    return sseResponse([
      { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
    ]);
  };

  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://llm-proxy.local/anthropic' },
    thinkingEnabled: true,
  });

  await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'hello' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: [],
  }, { continuation_tokens: [] });

  assert.deepEqual(requests[0].body.thinking, { type: 'enabled', budget_tokens: 4915 });
  assert.equal('betas' in requests[0].body, false);
  assert.equal('anthropic-beta' in requests[0].headers, false);
});

test('recovers full-text DSML tool calls into executable tool_call messages', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="wait_for_teammates">\n<｜｜DSML｜｜parameter name="timeoutMs" string="false">20000</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
      },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  ]);

  const emittedEvents = [];
  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    tools: ['wait_for_teammates'],
    onEvent: (type, payload) => emittedEvents.push({ type, payload }),
  });

  const stopReason = await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'wait' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: ['wait_for_teammates'],
  }, { continuation_tokens: [] });

  assert.equal(stopReason, 'tool_use');
  assert.deepEqual(executor.messages.map(({ type, toolName, toolInput }) => ({ type, toolName, toolInput })), [
    { type: 'tool_call', toolName: 'wait_for_teammates', toolInput: { timeoutMs: 20000 } },
  ]);
  assert.equal(emittedEvents.some(event => event.type === 'text_encoded_tool_call_recovered'), true);
});

test('does not treat unavailable text-encoded tool calls as final assistant text', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: {
        type: 'text_delta',
        text: '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="read_file">\n<｜｜DSML｜｜parameter name="path" string="true">server.js</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
      },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  ]);

  const executor = new AgentExecutor({
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    tools: [],
  });

  const stopReason = await executor._callLLM({
    apiMessages: [{ role: 'user', content: 'finalize' }],
    turnIndex: 1,
    systemPrompt: '',
    tools: [],
  }, { continuation_tokens: [] });

  assert.equal(stopReason, 'text_encoded_tool_unavailable');
  assert.deepEqual(executor.messages.map(({ role, type, content }) => ({ role, type, content })), [
    {
      role: 'system',
      type: 'system_alert',
      content: '⚠️ Model emitted a text-encoded tool call for unavailable tool `read_file`; it was not executed.',
    },
  ]);
});

test('run still emits done when final cleanup hook fails', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalCwd = process.cwd();
  const originalConsoleError = console.error;
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-final-cleanup-'));
  await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
  process.chdir(rootDir);

  t.after(async () => {
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });
  console.error = () => {};

  globalThis.fetch = async () => sseResponse([
    { type: 'message_start', message: { model: 'deepseek-v4', usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  ]);

  const emittedEvents = [];
  const executor = new AgentExecutor({
    harnessId: 'cleanup-failure',
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    onEvent: (type) => emittedEvents.push(type),
  });
  executor.hooks.register({
    async onLoopEnd() {
      throw new Error('cleanup failed');
    },
  });

  await assert.doesNotReject(() => executor.run(1));
  assert.equal(emittedEvents.includes('done'), true);
});

test('run gives one final synthesis turn after tool use exhausts max turns', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-tool-limit-final-'));
  await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const executor = new AgentExecutor({
    harnessId: 'tool-limit-final',
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    tools: ['get_current_time'],
  });
  let calls = 0;
  executor._callLLM = async (context) => {
    calls++;
    if (calls === 1) {
      executor.messages.push({
        role: 'assistant',
        type: 'tool_call',
        turn: context.turnIndex,
        id: 'toolu_time',
        toolName: 'get_current_time',
        toolInput: {},
      });
      return 'tool_use';
    }

    assert.deepEqual(context.tools, []);
    assert.match(context.systemPrompt, /final answer from the available tool results/i);
    executor.messages.push({
      role: 'assistant',
      type: 'text',
      turn: context.turnIndex,
      content: 'Final answer after tool result.',
    });
    return 'end_turn';
  };

  await executor.run(1);

  assert.equal(calls, 2);
  assert.equal(executor.lastRunStopReason, 'end_turn');
  assert.equal(executor.messages.at(-1).content, 'Final answer after tool result.');
});

test('run marks turn limit when final synthesis still attempts unavailable text-encoded tools', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-tool-limit-unavailable-'));
  await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const executor = new AgentExecutor({
    harnessId: 'tool-limit-unavailable',
    model: { id: 'deepseek', modelId: 'deepseek-v4', key: 'test', url: 'https://api.deepseek.com/anthropic' },
    tools: ['get_current_time'],
  });
  let calls = 0;
  executor._callLLM = async (context) => {
    calls++;
    if (calls === 1) {
      executor.messages.push({
        role: 'assistant',
        type: 'tool_call',
        turn: context.turnIndex,
        id: 'toolu_time',
        toolName: 'get_current_time',
        toolInput: {},
      });
      return 'tool_use';
    }

    executor.messages.push({
      role: 'system',
      type: 'system_alert',
      turn: context.turnIndex,
      content: '⚠️ Model emitted a text-encoded tool call for unavailable tool `read_file`; it was not executed.',
    });
    return 'text_encoded_tool_unavailable';
  };

  await executor.run(1);

  assert.equal(calls, 2);
  assert.equal(executor.lastRunStopReason, 'turn_limit');
});
