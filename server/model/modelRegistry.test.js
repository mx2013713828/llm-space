import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createModelRegistry,
  normalizeModelProfile,
  normalizeProtocol,
} from './modelRegistry.js';

test('normalizeProtocol accepts short UI aliases and canonical adapter ids', () => {
  assert.equal(normalizeProtocol('anthropic'), 'anthropic_messages');
  assert.equal(normalizeProtocol('anthropic_messages'), 'anthropic_messages');
  assert.equal(normalizeProtocol('openai'), 'openai_chat_completions');
  assert.equal(normalizeProtocol('openai_chat_completions'), 'openai_chat_completions');
});

test('normalizes legacy Anthropic-compatible model config without losing legacy fields', () => {
  const profile = normalizeModelProfile({
    id: 'ds-v4',
    name: 'DeepSeek V4',
    modelId: 'deepseek-v4',
    url: 'https://api.deepseek.com/anthropic',
    key: 'legacy-key',
  });

  assert.deepEqual({
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    url: profile.url,
    modelId: profile.modelId,
    apiKey: profile.apiKey,
    key: profile.key,
    contextWindow: profile.contextWindow,
  }, {
    id: 'ds-v4',
    name: 'DeepSeek V4',
    provider: 'deepseek',
    protocol: 'anthropic_messages',
    baseUrl: 'https://api.deepseek.com/anthropic',
    url: 'https://api.deepseek.com/anthropic',
    modelId: 'deepseek-v4',
    apiKey: 'legacy-key',
    key: 'legacy-key',
    contextWindow: 128000,
  });
  assert.equal(profile.capabilities.tools, true);
  assert.equal(profile.capabilities.thinking, true);
});

test('normalizes OpenAI-compatible model connection from new fields', () => {
  const profile = normalizeModelProfile({
    id: 'kimi-k2',
    name: 'Kimi K2',
    provider: 'kimi',
    protocol: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    modelId: 'kimi-k2',
    apiKey: 'moonshot-key',
    contextWindow: 256000,
    capabilities: {
      thinking: false,
      promptCache: false,
    },
  });

  assert.equal(profile.provider, 'kimi');
  assert.equal(profile.protocol, 'openai_chat_completions');
  assert.equal(profile.baseUrl, 'https://api.moonshot.ai/v1');
  assert.equal(profile.url, 'https://api.moonshot.ai/v1');
  assert.equal(profile.key, 'moonshot-key');
  assert.equal(profile.apiKey, 'moonshot-key');
  assert.equal(profile.contextWindow, 256000);
  assert.equal(profile.capabilities.tools, true);
  assert.equal(profile.capabilities.thinking, false);
  assert.equal(profile.capabilities.promptCache, false);
});

test('createModelRegistry resolves profiles by id and keeps a normalized list', () => {
  const registry = createModelRegistry([
    { id: 'glm', name: 'GLM', modelId: 'glm-4.5', provider: 'glm', protocol: 'openai', baseUrl: 'https://api.z.ai/api/paas/v4/', apiKey: 'z-key' },
    { id: 'claude', name: 'Claude', modelId: 'claude-sonnet-4-5', url: 'https://api.anthropic.com', key: 'a-key' },
  ]);

  assert.equal(registry.list().length, 2);
  assert.equal(registry.resolveModelProfile('glm').protocol, 'openai_chat_completions');
  assert.equal(registry.resolveModelProfile('claude').provider, 'anthropic');
  assert.throws(() => registry.resolveModelProfile('missing'), /Unknown model profile: missing/);
});
