import { normalizeSessionSnapshot } from './agentRunCompletion.js';
import { applyStreamMessageEvent, createStreamMessageState } from './streamMessageUpdates.js';

function cloneActiveIds(value) {
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function getEventMessageId(event) {
  return event?.id || null;
}

function markActiveForEvent(activeMessageIds, event) {
  const next = cloneActiveIds(activeMessageIds);
  const id = getEventMessageId(event);

  if (!id) return next;

  if (event.type === 'thinking_start' || event.type === 'text_start' || event.type === 'tool_start') {
    next.add(id);
  }

  if (event.type === 'thinking_end' || event.type === 'text_end' || event.type === 'tool_exec_done' || event.type === 'tool_exec_invalid') {
    next.delete(id);
  }

  return next;
}

export function createRunViewModelState(snapshot = {}) {
  const normalized = normalizeSessionSnapshot(snapshot);
  return {
    messages: normalized.messages,
    todos: normalized.todos,
    backgroundTasks: normalized.backgroundTasks,
    streamState: createStreamMessageState(),
    activeMessageIds: new Set(),
  };
}

export function applyRunEvent(state, event, options = {}) {
  const current = state || createRunViewModelState();
  const result = applyStreamMessageEvent(
    current.messages,
    current.streamState || createStreamMessageState(),
    event,
    options,
  );

  return {
    ...current,
    messages: result.messages,
    streamState: result.state,
    activeMessageIds: markActiveForEvent(current.activeMessageIds, event),
  };
}

function mergeActiveMessages(currentMessages, incomingMessages, activeMessageIds) {
  const currentById = new Map(
    currentMessages
      .filter(message => message?.id)
      .map(message => [message.id, message]),
  );
  const incomingIds = new Set();
  const merged = incomingMessages.map(message => {
    if (message?.id) incomingIds.add(message.id);
    if (message?.id && activeMessageIds.has(message.id) && currentById.has(message.id)) {
      return currentById.get(message.id);
    }
    return message;
  });

  for (const message of currentMessages) {
    if (message?.id && !incomingIds.has(message.id)) {
      merged.push(message);
    }
  }

  return merged;
}

export function applySessionSnapshotToRunState(state, snapshot, options = {}) {
  const current = state || createRunViewModelState();
  const normalized = normalizeSessionSnapshot(snapshot);
  const phase = options.phase || 'done';

  if (phase !== 'active') {
    return {
      ...current,
      messages: normalized.messages,
      todos: normalized.todos,
      backgroundTasks: normalized.backgroundTasks,
      activeMessageIds: new Set(),
      streamState: createStreamMessageState(),
    };
  }

  const activeMessageIds = cloneActiveIds(current.activeMessageIds);
  return {
    ...current,
    messages: mergeActiveMessages(current.messages, normalized.messages, activeMessageIds),
    todos: normalized.todos,
    backgroundTasks: normalized.backgroundTasks,
    activeMessageIds,
  };
}
