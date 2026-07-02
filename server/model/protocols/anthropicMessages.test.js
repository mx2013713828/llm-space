import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnthropicMessagesRequest } from './anthropicMessages.js';

test('buildAnthropicMessagesRequest preserves DeepSeek Anthropic-compatible thinking semantics', () => {
  const request = buildAnthropicMessagesRequest({
    modelProfile: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      modelId: 'deepseek-v4',
      apiKey: 'ds-key',
    },
    systemPrompt: 'system',
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    toolSchemas: [{ name: 'weather_report', description: 'Weather', input_schema: { type: 'object', properties: {}, required: [] } }],
    maxTokens: 8192,
    temperature: 0.4,
    thinkingEnabled: true,
    isContinuation: false,
  });

  assert.equal(request.url, 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(request.headers['x-api-key'], 'ds-key');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.equal('anthropic-beta' in request.headers, false);
  assert.equal(request.body.model, 'deepseek-v4');
  assert.deepEqual(request.body.thinking, { type: 'enabled', budget_tokens: 4915 });
  assert.equal('betas' in request.body, false);
  assert.equal(request.body.stream, true);
  assert.equal(request.body.tools.length, 1);
});

test('buildAnthropicMessagesRequest disables DeepSeek thinking explicitly when off', () => {
  const request = buildAnthropicMessagesRequest({
    modelProfile: {
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/anthropic',
      modelId: 'deepseek-v4',
      apiKey: 'ds-key',
    },
    systemPrompt: '',
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    toolSchemas: [],
    maxTokens: 4096,
    temperature: 0.2,
    thinkingEnabled: false,
  });

  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.equal(request.body.temperature, 0.2);
});

test('buildAnthropicMessagesRequest can build non-stream summary requests', () => {
  const request = buildAnthropicMessagesRequest({
    modelProfile: {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      modelId: 'claude-sonnet-4-5',
      apiKey: 'a-key',
    },
    systemPrompt: 'Summarize.',
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'long history' }] }],
    toolSchemas: [],
    maxTokens: 2048,
    thinkingEnabled: false,
    stream: false,
  });

  assert.equal(request.body.stream, false);
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
});
