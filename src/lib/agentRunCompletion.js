export function isAgentDoneEvent(event) {
  return event?.type === 'done';
}

export function normalizeSessionSnapshot(session) {
  return {
    messages: Array.isArray(session?.messages) ? session.messages : [],
    todos: Array.isArray(session?.todos) ? session.todos : [],
    backgroundTasks: Array.isArray(session?.backgroundTasks) ? session.backgroundTasks : [],
  };
}

function valueLength(value) {
  if (value == null) return 0;
  if (typeof value === 'string') return value.length;
  try {
    return JSON.stringify(value).length;
  } catch {
    return String(value).length;
  }
}

function messageProgressScore(message) {
  if (!message || typeof message !== 'object') return 0;

  let score = 0;
  score += valueLength(message.content);
  score += valueLength(message.toolOutput);
  score += valueLength(message.toolInputRaw);
  score += valueLength(message.finalPreview);
  score += valueLength(message.subAgentStatus?.currentAction);

  if (Array.isArray(message.subMessages)) {
    score += message.subMessages.reduce((sum, item) => sum + messageProgressScore(item), 0);
  }

  return score;
}

function snapshotProgressScore(snapshot) {
  return snapshot.messages.reduce((sum, message) => sum + messageProgressScore(message), 0)
    + valueLength(snapshot.todos)
    + valueLength(snapshot.backgroundTasks);
}

export function shouldApplyActiveSessionSnapshot(current, incoming, options = {}) {
  const {
    now = Date.now(),
    lastStreamAt = 0,
    minIdleMs = 5000,
  } = options;

  if (now - lastStreamAt < minIdleMs) return false;

  const currentSnapshot = normalizeSessionSnapshot(current);
  const incomingSnapshot = normalizeSessionSnapshot(incoming);

  if (incomingSnapshot.messages.length < currentSnapshot.messages.length) return false;
  if (incomingSnapshot.messages.length > currentSnapshot.messages.length) return true;

  return snapshotProgressScore(incomingSnapshot) > snapshotProgressScore(currentSnapshot);
}
