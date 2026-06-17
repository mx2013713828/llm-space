import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsageMetrics } from './usageNormalizer.js';

test('normalizes DeepSeek prompt cache hit and miss tokens', () => {
  const metrics = normalizeUsageMetrics({
    prompt_cache_hit_tokens: 1200,
    prompt_cache_miss_tokens: 300,
    input_tokens: 1500,
  });

  assert.equal(metrics.cacheProvider, 'deepseek');
  assert.equal(metrics.cacheHitTokens, 1200);
  assert.equal(metrics.cacheMissTokens, 300);
  assert.equal(metrics.cacheWriteTokens, 0);
  assert.equal(metrics.cacheSupportsWriteTokens, false);
  assert.equal(metrics.inputTokens, 1500);
  assert.equal(metrics.totalInputTokens, 1500);
});

test('treats DeepSeek Anthropic-compatible usage as DeepSeek when hinted by base URL', () => {
  const metrics = normalizeUsageMetrics({
    cache_read_input_tokens: 1200,
    cache_creation_input_tokens: 800,
    input_tokens: 300,
  }, {
    baseUrl: 'https://api.deepseek.com/anthropic',
    modelId: 'deepseek-v4-pro',
  });

  assert.equal(metrics.cacheProvider, 'deepseek');
  assert.equal(metrics.cacheHitTokens, 1200);
  assert.equal(metrics.cacheMissTokens, 300);
  assert.equal(metrics.cacheWriteTokens, 0);
  assert.equal(metrics.cacheSupportsWriteTokens, false);
  assert.equal(metrics.totalInputTokens, 1500);
});

test('normalizes Anthropic cache read, creation, and input tokens', () => {
  const metrics = normalizeUsageMetrics({
    cache_read_input_tokens: 5000,
    cache_creation_input_tokens: 2000,
    input_tokens: 250,
  });

  assert.equal(metrics.cacheProvider, 'anthropic');
  assert.equal(metrics.cacheHitTokens, 5000);
  assert.equal(metrics.cacheMissTokens, 250);
  assert.equal(metrics.cacheWriteTokens, 2000);
  assert.equal(metrics.cacheSupportsWriteTokens, true);
  assert.equal(metrics.inputTokens, 250);
  assert.equal(metrics.totalInputTokens, 7250);
});

test('falls back to input or prompt tokens for providers without cache fields', () => {
  const metrics = normalizeUsageMetrics({
    prompt_tokens: 900,
  });

  assert.equal(metrics.cacheProvider, 'generic');
  assert.equal(metrics.cacheHitTokens, 0);
  assert.equal(metrics.cacheMissTokens, 900);
  assert.equal(metrics.cacheWriteTokens, 0);
  assert.equal(metrics.cacheSupportsWriteTokens, false);
  assert.equal(metrics.inputTokens, 900);
  assert.equal(metrics.totalInputTokens, 900);
});

test('keeps unknown Anthropic-compatible model providers generic until cache fields are mapped', () => {
  const metrics = normalizeUsageMetrics({
    input_tokens: 700,
  }, {
    baseUrl: 'https://api.moonshot.cn/anthropic',
    modelId: 'kimi-k2',
  });

  assert.equal(metrics.cacheProvider, 'generic');
  assert.equal(metrics.cacheHitTokens, 0);
  assert.equal(metrics.cacheMissTokens, 700);
  assert.equal(metrics.cacheWriteTokens, 0);
  assert.equal(metrics.cacheSupportsWriteTokens, false);
});
