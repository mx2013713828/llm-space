export function parseProviderSseLines(lines = []) {
  const parsed = [];

  for (const line of lines) {
    if (typeof line !== 'string' || !line.startsWith('data: ')) continue;
    const raw = line.slice(6).trim();
    if (!raw || raw === '[DONE]') continue;

    try {
      parsed.push(JSON.parse(raw));
    } catch (error) {
      parsed.push({
        type: 'parse_error',
        raw,
        error: error.message,
      });
    }
  }

  return parsed;
}

export function createAnthropicCompatibleStreamState() {
  return {
    blocksByIndex: new Map(),
  };
}

export function normalizeAnthropicCompatibleEvent(event = {}, state = createAnthropicCompatibleStreamState()) {
  switch (event.type) {
    case 'message_start':
      return [{
        type: 'message_start',
        model: event.message?.model,
        usage: event.message?.usage,
      }];

    case 'content_block_start':
      return normalizeContentBlockStart(event, state);

    case 'content_block_delta':
      return normalizeContentBlockDelta(event, state);

    case 'content_block_stop':
      return normalizeContentBlockStop(event, state);

    case 'message_delta':
      return [{
        type: 'message_delta',
        stopReason: event.delta?.stop_reason,
        usage: event.usage,
      }];

    case 'error':
      return [{
        type: 'provider_error',
        message: event.error?.message || '未知错误',
      }];

    default:
      return [];
  }
}

function normalizeContentBlockStart(event, state) {
  const index = event.index;
  const block = event.content_block || {};
  state.blocksByIndex.set(index, {
    type: block.type,
    id: block.id,
    name: block.name,
    signature: block.signature || '',
  });

  if (block.type === 'thinking') {
    return [{ type: 'thinking_start', index, signature: block.signature || '' }];
  }

  if (block.type === 'text') {
    return [{ type: 'text_start', index }];
  }

  if (block.type === 'tool_use') {
    return [{ type: 'tool_start', index, id: block.id, name: block.name }];
  }

  return [];
}

function normalizeContentBlockDelta(event, state) {
  const index = event.index;
  const delta = event.delta || {};

  if (delta.type === 'thinking_delta') {
    ensureBlock(state, index, { type: 'thinking', signature: '' });
    return [{ type: 'thinking_delta', index, text: delta.thinking || '' }];
  }

  if (delta.type === 'text_delta') {
    const block = state.blocksByIndex.get(index);
    const output = [];

    if (!block) {
      state.blocksByIndex.set(index, { type: 'text' });
      output.push({ type: 'text_start', index, recovered: true });
    } else if (block.type !== 'text') {
      output.push(...normalizeSyntheticBlockEnd(index, block.type));
      state.blocksByIndex.set(index, { type: 'text' });
      output.push({ type: 'text_start', index, recovered: true });
    }

    output.push({ type: 'text_delta', index, text: delta.text || '' });
    return output;
  }

  if (delta.type === 'input_json_delta') {
    ensureBlock(state, index, { type: 'tool_use' });
    return [{
      type: 'tool_input_delta',
      index,
      partialJson: delta.partial_json || '',
    }];
  }

  return [];
}

function normalizeContentBlockStop(event, state) {
  const index = event.index;
  const block = state.blocksByIndex.get(index);
  if (!block) return [];

  state.blocksByIndex.delete(index);
  return normalizeSyntheticBlockEnd(index, block.type);
}

function ensureBlock(state, index, block) {
  if (!state.blocksByIndex.has(index)) {
    state.blocksByIndex.set(index, block);
  }
}

function normalizeSyntheticBlockEnd(index, blockType) {
  if (blockType === 'thinking') return [{ type: 'thinking_end', index }];
  if (blockType === 'text') return [{ type: 'text_end', index }];
  if (blockType === 'tool_use') return [{ type: 'tool_end', index }];
  return [];
}
