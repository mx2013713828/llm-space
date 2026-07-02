export const DEFAULT_CONTEXT_WINDOW = 128000;
export const PROTOCOL_ANTHROPIC_MESSAGES = 'anthropic_messages';
export const PROTOCOL_OPENAI_CHAT_COMPLETIONS = 'openai_chat_completions';

export function normalizeProtocol(protocol, model = {}) {
  const value = String(protocol || '').trim().toLowerCase();
  if (['anthropic', 'anthropic_messages', 'anthropic-messages'].includes(value)) {
    return PROTOCOL_ANTHROPIC_MESSAGES;
  }
  if (['openai', 'openai_chat', 'openai-chat', 'openai_chat_completions', 'openai-chat-completions', 'chat_completions'].includes(value)) {
    return PROTOCOL_OPENAI_CHAT_COMPLETIONS;
  }

  return inferProtocol(model);
}

export function normalizeModelProfile(model = {}) {
  const baseUrl = String(model.baseUrl || model.url || '').trim();
  const apiKey = model.apiKey ?? model.key ?? '';
  const provider = normalizeProvider(model.provider || inferProvider(model, baseUrl));
  const protocol = normalizeProtocol(model.protocol, { ...model, provider, baseUrl });

  return {
    ...model,
    id: String(model.id || model.modelId || model.name || '').trim(),
    name: model.name || model.modelId || model.id || 'Unnamed Model',
    provider,
    protocol,
    baseUrl,
    url: baseUrl,
    modelId: model.modelId || model.id || '',
    apiKey,
    key: apiKey,
    contextWindow: parseContextWindow(model.contextWindow ?? model.context_window),
    cacheSemantics: {
      promptCache: model.cacheSemantics?.promptCache ?? model.capabilities?.promptCache ?? protocol === PROTOCOL_ANTHROPIC_MESSAGES,
      cacheWrite: model.cacheSemantics?.cacheWrite ?? model.capabilities?.cacheWrite ?? provider === 'anthropic',
    },
    capabilities: {
      tools: model.capabilities?.tools ?? true,
      thinking: model.capabilities?.thinking ?? protocol === PROTOCOL_ANTHROPIC_MESSAGES,
      promptCache: model.capabilities?.promptCache ?? protocol === PROTOCOL_ANTHROPIC_MESSAGES,
      cacheWrite: model.capabilities?.cacheWrite ?? provider === 'anthropic',
      ...(model.capabilities || {}),
    },
  };
}

export function createModelRegistry(models = []) {
  const normalized = models.map(normalizeModelProfile);

  return {
    list() {
      return normalized.map(model => ({ ...model }));
    },
    resolveModelProfile(id) {
      const profile = normalized.find(model => String(model.id) === String(id));
      if (!profile) {
        throw new Error(`Unknown model profile: ${id}`);
      }
      return { ...profile };
    },
  };
}

function parseContextWindow(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CONTEXT_WINDOW;
}

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (value === 'moonshot') return 'kimi';
  if (value === 'zhipu' || value === 'z.ai' || value === 'zai') return 'glm';
  return value || 'custom';
}

function inferProvider(model = {}, baseUrl = '') {
  const haystack = [
    model.id,
    model.name,
    model.modelId,
    baseUrl,
  ].map(value => String(value || '').toLowerCase()).join(' ');

  if (haystack.includes('deepseek')) return 'deepseek';
  if (haystack.includes('moonshot') || haystack.includes('kimi')) return 'kimi';
  if (haystack.includes('bigmodel') || haystack.includes('z.ai') || haystack.includes('glm')) return 'glm';
  if (haystack.includes('minimax')) return 'minimax';
  if (haystack.includes('anthropic') || haystack.includes('claude')) return 'anthropic';
  if (haystack.includes('openai') || haystack.includes('gpt-')) return 'openai';
  return 'custom';
}

function inferProtocol(model = {}) {
  const haystack = [
    model.baseUrl,
    model.url,
    model.modelId,
    model.name,
    model.provider,
  ].map(value => String(value || '').toLowerCase()).join(' ');

  if (haystack.includes('/anthropic') || haystack.includes('anthropic.com') || haystack.includes('claude')) {
    return PROTOCOL_ANTHROPIC_MESSAGES;
  }

  return PROTOCOL_OPENAI_CHAT_COMPLETIONS;
}
