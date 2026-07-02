import { alignRequestPayload } from '../../../src/lib/messageBuilder.js';

export function buildAnthropicMessagesRequest({
  modelProfile,
  systemPrompt = '',
  apiMessages = [],
  toolSchemas = [],
  maxTokens = 8192,
  temperature,
  thinkingEnabled = false,
  isContinuation = false,
  stream = true,
} = {}) {
  const baseUrl = cleanBaseUrl(modelProfile?.baseUrl || modelProfile?.url || 'https://api.anthropic.com');
  const endpoint = `${baseUrl}/v1/messages`;
  const isDeepSeek = modelProfile?.provider === 'deepseek';
  const aligned = alignRequestPayload(systemPrompt, toolSchemas, apiMessages, modelProfile);
  const messagesToSend = [...(aligned.messages || [])];

  if (isContinuation && !endpoint.includes('anthropic.com')) {
    messagesToSend.push({
      role: 'user',
      content: 'Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
    });
  }

  const body = {
    model: modelProfile?.modelId || 'claude-sonnet-4-5',
    max_tokens: maxTokens || 8192,
    system: aligned.system || '',
    messages: messagesToSend,
    stream,
  };

  if (aligned.tools && aligned.tools.length > 0) {
    body.tools = aligned.tools;
  }

  if (thinkingEnabled) {
    body.thinking = {
      type: 'enabled',
      budget_tokens: Math.floor(Math.min(maxTokens * 0.6 || 5000, 10000)),
    };
    if (!isDeepSeek) {
      body.temperature = 1;
      body.betas = ['interleaved-thinking-2025-05-07'];
    }
  } else if (isDeepSeek) {
    body.thinking = { type: 'disabled' };
    if (temperature !== undefined) body.temperature = temperature;
  } else if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': modelProfile?.apiKey || modelProfile?.key || '',
    'anthropic-version': '2023-06-01',
  };
  if (thinkingEnabled && !isDeepSeek) {
    headers['anthropic-beta'] = 'interleaved-thinking-2025-05-07';
  }

  return {
    url: endpoint,
    headers,
    body,
  };
}

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}
