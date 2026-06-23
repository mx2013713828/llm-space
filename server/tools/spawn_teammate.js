export default {
  name: 'spawn_teammate',
  description: 'Spawn a finite asynchronous teammate for scoped work.',
  parameters: {
    name: { type: 'string', required: true, description: 'Stable teammate name.' },
    role: { type: 'string', required: false, description: 'Short role description.' },
    prompt: { type: 'string', required: true, description: 'Task prompt for the teammate.' },
    maxTurns: { type: 'number', required: false, description: 'Maximum teammate turns. Defaults to 6.' },
  },
  async execute() {
    throw new Error('spawn_teammate is handled by TeamPlugin');
  },
};
