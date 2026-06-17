export function createCacheStats() {
  return {
    hitTokens: 0,
    missTokens: 0,
    writeTokens: 0,
    supportsWriteTokens: false,
    provider: null,
  };
}

export function accumulateCacheStats(prevStats, event) {
  const provider = event.cacheProvider || prevStats.provider || 'generic';
  const base = prevStats.provider && prevStats.provider !== provider
    ? createCacheStats()
    : prevStats;

  return {
    hitTokens: base.hitTokens + (event.cacheHitTokens ?? event.cacheReadTokens ?? 0),
    missTokens: base.missTokens + (event.cacheMissTokens ?? event.inputTokens ?? 0),
    writeTokens: base.writeTokens + (event.cacheWriteTokens ?? event.cacheCreationTokens ?? 0),
    supportsWriteTokens: !!event.cacheSupportsWriteTokens,
    provider,
  };
}
