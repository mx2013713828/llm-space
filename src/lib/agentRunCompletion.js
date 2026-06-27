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
