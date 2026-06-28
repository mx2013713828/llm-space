export function createStreamMessageState() {
  return {
    activeThinkingId: null,
    activeTextId: null,
    activeToolId: null,
  };
}

function findLastMessageIndex(messages, predicate) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (predicate(messages[i])) return i;
  }
  return -1;
}

function updateMessageByIndex(messages, targetIdx, updater) {
  if (targetIdx === -1) return messages;
  return messages.map((message, idx) => (
    idx === targetIdx ? updater(message) : message
  ));
}

function findStreamTargetIndex(messages, id, fallbackPredicate) {
  if (id) {
    const byId = messages.findIndex(message => message.id === id);
    if (byId !== -1) return byId;
  }
  return findLastMessageIndex(messages, fallbackPredicate);
}

export function applyStreamMessageEvent(messages, state, event, options = {}) {
  const lastInputTokens = options.lastInputTokens || 0;
  const currentState = state || createStreamMessageState();

  if (event.type === 'thinking_start') {
    const id = event.id || `thinking_${event.turn || 'unknown'}_${event.index ?? messages.length}`;
    return {
      state: { ...currentState, activeThinkingId: id },
      messages: [
        ...messages,
        {
          id,
          role: 'assistant',
          type: 'thinking',
          turn: event.turn,
          content: '',
          tokens: { input: lastInputTokens, output: 0 },
          signature: event.signature,
          streaming: true,
        },
      ],
    };
  }

  if (event.type === 'thinking_delta') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id || currentState.activeThinkingId,
      message => message.role === 'assistant' && message.type === 'thinking',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        content: (message.content || '') + (event.text || ''),
      })),
    };
  }

  if (event.type === 'text_start') {
    if (event.isContinuation) {
      const targetIdx = findLastMessageIndex(messages, message => message.role === 'assistant' && message.type === 'text');
      return {
        state: {
          ...currentState,
          activeTextId: targetIdx === -1 ? currentState.activeTextId : messages[targetIdx].id,
        },
        messages,
      };
    }

    const id = event.id || `text_${event.turn || 'unknown'}_${event.index ?? messages.length}`;
    return {
      state: { ...currentState, activeTextId: id },
      messages: [
        ...messages,
        {
          id,
          role: 'assistant',
          type: 'text',
          turn: event.turn,
          content: '',
          tokens: { input: lastInputTokens, output: 0 },
          streaming: true,
        },
      ],
    };
  }

  if (event.type === 'text_delta') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id || currentState.activeTextId,
      message => message.role === 'assistant' && message.type === 'text',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        content: (message.content || '') + (event.text || ''),
      })),
    };
  }

  if (event.type === 'thinking_end' || event.type === 'text_end') {
    const expectedType = event.type === 'thinking_end' ? 'thinking' : 'text';
    const stateKey = expectedType === 'thinking' ? 'activeThinkingId' : 'activeTextId';
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id || currentState[stateKey],
      message => message.role === 'assistant' && message.type === expectedType,
    );
    return {
      state: {
        ...currentState,
        [stateKey]: null,
      },
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        streaming: false,
      })),
    };
  }

  if (event.type === 'tool_start') {
    const id = event.id;
    return {
      state: { ...currentState, activeToolId: id || currentState.activeToolId },
      messages: [
        ...messages,
        {
          role: 'assistant',
          type: 'tool_call',
          turn: event.turn,
          id,
          toolName: event.name,
          toolInputRaw: '',
          toolInput: {},
          toolStatus: 'pending',
        },
      ],
    };
  }

  if (event.type === 'tool_exec_start') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id,
      message => message.role === 'assistant' && message.type === 'tool_call',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        toolStatus: 'running',
      })),
    };
  }

  if (event.type === 'tool_input_delta') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id || currentState.activeToolId,
      message => message.role === 'assistant' && message.type === 'tool_call',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => {
        const newRaw = (message.toolInputRaw || '') + (event.partial || '');
        let parsed = { ...(message.toolInput || {}) };
        try { parsed = JSON.parse(newRaw); } catch { /* keep partial input */ }
        return { ...message, toolInputRaw: newRaw, toolInput: parsed };
      }),
    };
  }

  if (event.type === 'tool_end') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id || currentState.activeToolId,
      message => message.role === 'assistant' && message.type === 'tool_call',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        toolInput: event.input || message.toolInput,
      })),
    };
  }

  if (event.type === 'tool_exec_invalid') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id,
      message => message.role === 'assistant' && message.type === 'tool_call',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        toolStatus: 'invalid_args',
        toolOutput: `[Invalid tool arguments]\n${event.error?.message || 'Invalid tool arguments.'}`,
      })),
    };
  }

  if (event.type === 'tool_exec_chunk' || event.type === 'tool_exec_done') {
    const targetIdx = findStreamTargetIndex(
      messages,
      event.id,
      message => message.role === 'assistant' && message.type === 'tool_call',
    );
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => ({
        ...message,
        toolStatus: event.type === 'tool_exec_done' ? (event.status || 'completed') : (message.toolStatus || 'running'),
        toolOutput: event.type === 'tool_exec_done'
          ? String(event.output)
          : `${message.toolOutput || ''}${event.content || ''}`,
      })),
    };
  }

  if (event.type === 'message_delta') {
    const targetIdx = findLastMessageIndex(messages, message => message.role === 'assistant');
    return {
      state: currentState,
      messages: updateMessageByIndex(messages, targetIdx, message => (
        event.outputTokens
          ? { ...message, tokens: { ...message.tokens, output: event.outputTokens } }
          : message
      )),
    };
  }

  return { messages, state: currentState };
}
