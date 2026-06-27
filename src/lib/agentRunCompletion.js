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

export function isDifferentSessionSnapshot(current, incoming) {
  return JSON.stringify(normalizeSessionSnapshot(current)) !== JSON.stringify(normalizeSessionSnapshot(incoming));
}
