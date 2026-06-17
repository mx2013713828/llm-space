import test from 'node:test';
import assert from 'node:assert/strict';
import { createCacheStats, accumulateCacheStats } from './cacheStats.js';

test('starts a fresh cache stats bucket when provider changes to DeepSeek', () => {
  const anthropicStats = accumulateCacheStats(createCacheStats(), {
    cacheProvider: 'anthropic',
    cacheHitTokens: 100,
    cacheMissTokens: 20,
    cacheWriteTokens: 80,
    cacheSupportsWriteTokens: true,
  });

  const deepSeekStats = accumulateCacheStats(anthropicStats, {
    cacheProvider: 'deepseek',
    cacheHitTokens: 30,
    cacheMissTokens: 10,
    cacheWriteTokens: 0,
    cacheSupportsWriteTokens: false,
  });

  assert.deepEqual(deepSeekStats, {
    hitTokens: 30,
    missTokens: 10,
    writeTokens: 0,
    supportsWriteTokens: false,
    provider: 'deepseek',
  });
});

test('keeps accumulating within the same provider', () => {
  const stats = accumulateCacheStats(createCacheStats(), {
    cacheProvider: 'deepseek',
    cacheHitTokens: 30,
    cacheMissTokens: 10,
    cacheWriteTokens: 0,
    cacheSupportsWriteTokens: false,
  });

  const nextStats = accumulateCacheStats(stats, {
    cacheProvider: 'deepseek',
    cacheHitTokens: 50,
    cacheMissTokens: 20,
    cacheWriteTokens: 0,
    cacheSupportsWriteTokens: false,
  });

  assert.deepEqual(nextStats, {
    hitTokens: 80,
    missTokens: 30,
    writeTokens: 0,
    supportsWriteTokens: false,
    provider: 'deepseek',
  });
});
