export function buildOpenAIChatCompletionsRequest({
  modelProfile,
  systemPrompt = '',
  apiMessages = [],
  toolSchemas = [],
  maxTokens = 8192,
  temperature,
  stream = true,
} = {}) {
  const baseUrl = cleanBaseUrl(modelProfile?.baseUrl || modelProfile?.url || 'https://api.openai.com/v1');
  const body = {
    model: modelProfile?.modelId || modelProfile?.id || '',
    messages: convertMessagesForOpenAI({ systemPrompt, apiMessages }),
    stream,
    max_tokens: maxTokens || 8192,
  };

  if (temperature !== undefined) {
    body.temperature = temperature;
  }

  const tools = convertToolsForOpenAI(toolSchemas);
  if (tools.length > 0) {
    body.tools = tools;
  }

  return {
    url: baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${modelProfile?.apiKey || modelProfile?.key || ''}`,
    },
    body,
  };
}

export function createOpenAIChatCompletionsStreamState() {
  return {
    hasStartedMessage: false,
    textStarted: false,
    activeToolsByOpenAIIndex: new Map(),
  };
}

export function normalizeOpenAIChatCompletionsEvent(event = {}, state = createOpenAIChatCompletionsStreamState()) {
  const output = [];

  if (!state.hasStartedMessage && (event.model || event.usage || event.id || event.choices)) {
    state.hasStartedMessage = true;
    output.push({
      type: 'message_start',
      model: event.model,
      usage: event.usage,
    });
  }

  for (const choice of event.choices || []) {
    const delta = choice.delta || {};

    if (typeof delta.content === 'string' && delta.content.length > 0) {
      if (!state.textStarted) {
        state.textStarted = true;
        output.push({ type: 'text_start', index: 0 });
      }
      output.push({ type: 'text_delta', index: 0, text: delta.content });
    }

    for (const toolCall of delta.tool_calls || []) {
      const openAIIndex = toolCall.index ?? 0;
      const runtimeIndex = openAIIndex + 1;
      if (!state.activeToolsByOpenAIIndex.has(openAIIndex)) {
        state.activeToolsByOpenAIIndex.set(openAIIndex, {
          runtimeIndex,
          id: toolCall.id,
          name: toolCall.function?.name || '',
        });
        output.push({
          type: 'tool_start',
          index: runtimeIndex,
          id: toolCall.id,
          name: toolCall.function?.name || '',
        });
      }

      const partialJson = toolCall.function?.arguments;
      if (typeof partialJson === 'string' && partialJson.length > 0) {
        output.push({
          type: 'tool_input_delta',
          index: runtimeIndex,
          partialJson,
        });
      }
    }

    if (choice.finish_reason) {
      if (state.textStarted) {
        output.push({ type: 'text_end', index: 0 });
        state.textStarted = false;
      }

      for (const tool of state.activeToolsByOpenAIIndex.values()) {
        output.push({ type: 'tool_end', index: tool.runtimeIndex });
      }
      state.activeToolsByOpenAIIndex.clear();

      output.push({
        type: 'message_delta',
        stopReason: mapFinishReason(choice.finish_reason),
        usage: event.usage,
      });
    }
  }

  if (event.error) {
    output.push({ type: 'provider_error', message: event.error.message || '未知错误' });
  }

  return output;
}

function convertToolsForOpenAI(toolSchemas = []) {
  return (toolSchemas || []).map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.input_schema || { type: 'object', properties: {}, required: [] },
    },
  }));
}

function convertMessagesForOpenAI({ systemPrompt = '', apiMessages = [] } = {}) {
  const converted = [];
  if (systemPrompt) {
    converted.push({ role: 'system', content: systemPrompt });
  }

  for (const message of apiMessages || []) {
    if (message.role === 'user') {
      converted.push(...convertUserMessage(message));
    } else if (message.role === 'assistant') {
      const assistant = convertAssistantMessage(message);
      if (assistant) converted.push(assistant);
    } else if (message.role === 'system') {
      converted.push({ role: 'system', content: contentBlocksToText(message.content) });
    }
  }

  return converted;
}

function convertUserMessage(message) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content || '') }];
  const output = [];
  const textParts = [];

  for (const block of blocks) {
    if (block?.type === 'tool_result') {
      if (textParts.length > 0) {
        output.push({ role: 'user', content: textParts.join('\n') });
        textParts.length = 0;
      }
      output.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: String(block.content ?? ''),
      });
    } else if (block?.type === 'text') {
      textParts.push(block.text || '');
    }
  }

  if (textParts.length > 0) {
    output.push({ role: 'user', content: textParts.join('\n') });
  }

  return output;
}

function convertAssistantMessage(message) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content || '') }];
  const textParts = [];
  const toolCalls = [];

  for (const block of blocks) {
    if (block?.type === 'text') {
      textParts.push(block.text || '');
    } else if (block?.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      });
    }
  }

  if (textParts.length === 0 && toolCalls.length === 0) {
    return null;
  }

  const result = {
    role: 'assistant',
    content: textParts.join('\n') || null,
  };
  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }
  return result;
}

function contentBlocksToText(content) {
  if (!Array.isArray(content)) return String(content || '');
  return content
    .filter(block => block?.type === 'text')
    .map(block => block.text || '')
    .join('\n');
}

function mapFinishReason(reason) {
  if (reason === 'tool_calls' || reason === 'function_call') return 'tool_use';
  if (reason === 'stop') return 'end_turn';
  if (reason === 'length') return 'max_tokens';
  return reason;
}

function cleanBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/$/, '');
}
