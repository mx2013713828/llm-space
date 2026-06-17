function toNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function inferModelProvider(usage = {}, options = {}) {
  const providerHint = String(options.providerHint || '').toLowerCase();
  const baseUrl = String(options.baseUrl || options.url || '').toLowerCase();
  const modelId = String(options.modelId || options.model || '').toLowerCase();

  if (
    providerHint.includes('deepseek') ||
    baseUrl.includes('deepseek') ||
    modelId.includes('deepseek') ||
    usage.prompt_cache_hit_tokens !== undefined ||
    usage.prompt_cache_miss_tokens !== undefined
  ) {
    return 'deepseek';
  }

  if (
    providerHint.includes('anthropic') ||
    modelId.includes('claude') ||
    baseUrl.includes('api.anthropic.com') ||
    baseUrl.includes('console.anthropic.com') ||
    usage.cache_read_input_tokens !== undefined ||
    usage.cache_creation_input_tokens !== undefined
  ) {
    return 'anthropic';
  }

  return 'generic';
}

export function normalizeUsageMetrics(usage = {}, options = {}) {
  const provider = inferModelProvider(usage, options);
  const deepSeekHit = usage.prompt_cache_hit_tokens;
  const deepSeekMiss = usage.prompt_cache_miss_tokens;

  if (provider === 'deepseek') {
    const cacheHitTokens = toNumber(deepSeekHit ?? usage.cache_read_input_tokens);
    const cacheMissTokens = toNumber(deepSeekMiss ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.cache_creation_input_tokens);
    const inputTokens = toNumber(usage.input_tokens ?? usage.prompt_tokens ?? cacheHitTokens + cacheMissTokens);

    return {
      cacheProvider: 'deepseek',
      inputTokens,
      cacheHitTokens,
      cacheMissTokens,
      cacheWriteTokens: 0,
      cacheSupportsWriteTokens: false,
      totalInputTokens: cacheHitTokens + cacheMissTokens,
      rawUsage: usage,
    };
  }

  const anthropicHit = usage.cache_read_input_tokens;
  const anthropicWrite = usage.cache_creation_input_tokens;

  if (provider === 'anthropic') {
    const cacheHitTokens = toNumber(anthropicHit);
    const cacheWriteTokens = toNumber(anthropicWrite);
    const cacheMissTokens = toNumber(usage.input_tokens ?? usage.prompt_tokens);

    return {
      cacheProvider: 'anthropic',
      inputTokens: cacheMissTokens,
      cacheHitTokens,
      cacheMissTokens,
      cacheWriteTokens,
      cacheSupportsWriteTokens: true,
      totalInputTokens: cacheHitTokens + cacheWriteTokens + cacheMissTokens,
      rawUsage: usage,
    };
  }

  const inputTokens = toNumber(usage.prompt_tokens ?? usage.input_tokens);
  return {
    cacheProvider: 'generic',
    inputTokens,
    cacheHitTokens: 0,
    cacheMissTokens: inputTokens,
    cacheWriteTokens: 0,
    cacheSupportsWriteTokens: false,
    totalInputTokens: inputTokens,
    rawUsage: usage,
  };
}
