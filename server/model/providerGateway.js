import {
  PROTOCOL_ANTHROPIC_MESSAGES,
  PROTOCOL_OPENAI_CHAT_COMPLETIONS,
  normalizeProtocol,
} from './modelRegistry.js';
import { normalizeAnthropicCompatibleEvent, createAnthropicCompatibleStreamState } from './streamParser.js';
import { buildAnthropicMessagesRequest } from './protocols/anthropicMessages.js';
import {
  buildOpenAIChatCompletionsRequest,
  createOpenAIChatCompletionsStreamState,
  normalizeOpenAIChatCompletionsEvent,
} from './protocols/openaiChatCompletions.js';

export function buildModelGatewayRequest(options = {}) {
  const protocol = normalizeProtocol(options.modelProfile?.protocol, options.modelProfile);

  if (protocol === PROTOCOL_ANTHROPIC_MESSAGES) {
    return buildAnthropicMessagesRequest(options);
  }

  if (protocol === PROTOCOL_OPENAI_CHAT_COMPLETIONS) {
    return buildOpenAIChatCompletionsRequest(options);
  }

  throw new Error(`Unsupported model protocol: ${options.modelProfile?.protocol || protocol}`);
}

export function createModelGatewayStreamNormalizer(modelProfile = {}) {
  const protocol = normalizeProtocol(modelProfile.protocol, modelProfile);

  if (protocol === PROTOCOL_ANTHROPIC_MESSAGES) {
    const state = createAnthropicCompatibleStreamState();
    return event => normalizeAnthropicCompatibleEvent(event, state);
  }

  if (protocol === PROTOCOL_OPENAI_CHAT_COMPLETIONS) {
    const state = createOpenAIChatCompletionsStreamState();
    return event => normalizeOpenAIChatCompletionsEvent(event, state);
  }

  throw new Error(`Unsupported model protocol: ${modelProfile.protocol || protocol}`);
}
