import test from 'node:test';
import assert from 'node:assert/strict';
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
