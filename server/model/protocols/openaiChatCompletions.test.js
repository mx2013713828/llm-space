import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenAIChatCompletionsRequest,
  createOpenAIChatCompletionsStreamState,
  normalizeOpenAIChatCompletionsEvent,
} from './openaiChatCompletions.js';

test('buildOpenAIChatCompletionsRequest converts internal tools and tool results', () => {
  const request = buildOpenAIChatCompletionsRequest({
    modelProfile: {
      provider: 'kimi',
      baseUrl: 'https://api.moonshot.ai/v1',
      modelId: 'kimi-k2',
      apiKey: 'kimi-key',
    },
    systemPrompt: 'You are helpful.',
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'toolu_1', name: 'weather_report', input: { city: 'Linyi' } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Overcast' }] },
    ],
    toolSchemas: [{
      name: 'weather_report',
      description: 'Weather report',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    }],
    maxTokens: 4096,
    temperature: 0.7,
    thinkingEnabled: false,
  });

  assert.equal(request.url, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(request.headers.Authorization, 'Bearer kimi-key');
  assert.equal(request.body.model, 'kimi-k2');
  assert.equal(request.body.max_tokens, 4096);
  assert.equal(request.body.stream, true);
  assert.deepEqual(request.body.tools, [{
    type: 'function',
    function: {
      name: 'weather_report',
      description: 'Weather report',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  }]);
  assert.deepEqual(request.body.messages, [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'weather?' },
    {
      role: 'assistant',
      content: 'Checking.',
      tool_calls: [{
        id: 'toolu_1',
        type: 'function',
        function: {
          name: 'weather_report',
          arguments: '{"city":"Linyi"}',
        },
      }],
    },
    { role: 'tool', tool_call_id: 'toolu_1', content: 'Overcast' },
  ]);
});

test('normalizeOpenAIChatCompletionsEvent emits text and tool runtime events', () => {
  const state = createOpenAIChatCompletionsStreamState();
  const normalized = [
    ...normalizeOpenAIChatCompletionsEvent({
      id: 'chatcmpl_1',
      model: 'kimi-k2',
      choices: [{ delta: { role: 'assistant' } }],
      usage: { prompt_tokens: 10 },
    }, state),
    ...normalizeOpenAIChatCompletionsEvent({
      choices: [{ delta: { content: 'Checking.' } }],
    }, state),
    ...normalizeOpenAIChatCompletionsEvent({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'weather_report', arguments: '{"city"' },
          }],
        },
      }],
    }, state),
    ...normalizeOpenAIChatCompletionsEvent({
      choices: [{
        delta: {
          tool_calls: [{
            index: 0,
            function: { arguments: ':"Linyi"}' },
          }],
        },
      }],
    }, state),
    ...normalizeOpenAIChatCompletionsEvent({
      choices: [{ finish_reason: 'tool_calls' }],
      usage: { completion_tokens: 8 },
    }, state),
  ];

  assert.deepEqual(normalized, [
    { type: 'message_start', model: 'kimi-k2', usage: { prompt_tokens: 10 } },
    { type: 'text_start', index: 0 },
    { type: 'text_delta', index: 0, text: 'Checking.' },
    { type: 'tool_start', index: 1, id: 'call_1', name: 'weather_report' },
    { type: 'tool_input_delta', index: 1, partialJson: '{"city"' },
    { type: 'tool_input_delta', index: 1, partialJson: ':"Linyi"}' },
    { type: 'text_end', index: 0 },
    { type: 'tool_end', index: 1 },
    { type: 'message_delta', stopReason: 'tool_use', usage: { completion_tokens: 8 } },
  ]);
});
