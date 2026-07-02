import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelGatewayRequest,
  createModelGatewayStreamNormalizer,
} from './providerGateway.js';

test('buildModelGatewayRequest dispatches to Anthropic Messages adapter', () => {
  const request = buildModelGatewayRequest({
    modelProfile: {
      provider: 'deepseek',
      protocol: 'anthropic_messages',
      baseUrl: 'https://api.deepseek.com/anthropic',
      modelId: 'deepseek-v4',
      apiKey: 'k',
    },
    systemPrompt: '',
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    toolSchemas: [],
    maxTokens: 1000,
    thinkingEnabled: false,
  });

  assert.equal(request.url, 'https://api.deepseek.com/anthropic/v1/messages');
  assert.equal(request.body.model, 'deepseek-v4');
  assert.equal(request.headers['x-api-key'], 'k');
});

test('buildModelGatewayRequest dispatches to OpenAI Chat Completions adapter', () => {
  const request = buildModelGatewayRequest({
    modelProfile: {
      provider: 'kimi',
      protocol: 'openai_chat_completions',
      baseUrl: 'https://api.moonshot.ai/v1',
      modelId: 'kimi-k2',
      apiKey: 'k',
    },
    systemPrompt: 'system',
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    toolSchemas: [],
    maxTokens: 1000,
    thinkingEnabled: false,
  });

  assert.equal(request.url, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(request.body.messages[0].role, 'system');
  assert.equal(request.headers.Authorization, 'Bearer k');
});

test('createModelGatewayStreamNormalizer dispatches protocol stream events', () => {
  const normalize = createModelGatewayStreamNormalizer({
    protocol: 'openai_chat_completions',
  });

  assert.deepEqual(normalize({
    model: 'kimi-k2',
    choices: [{ delta: { content: 'Hi' } }],
  }), [
    { type: 'message_start', model: 'kimi-k2', usage: undefined },
    { type: 'text_start', index: 0 },
    { type: 'text_delta', index: 0, text: 'Hi' },
  ]);
});

test('buildModelGatewayRequest rejects unsupported protocols', () => {
  assert.throws(() => buildModelGatewayRequest({
    modelProfile: { protocol: 'native_magic' },
  }), /Unsupported model protocol: native_magic/);
});
