export default {
  name: 'spawn_teammate',
  description: 'Spawn an asynchronous teammate for scoped work.',
  parameters: {
    name: { type: 'string', required: true, description: 'Stable teammate name.' },
    role: { type: 'string', required: false, description: 'Short role description.' },
    prompt: { type: 'string', required: false, description: 'Legacy free-form task prompt or additional context for the teammate.' },
    objective: { type: 'string', required: false, description: 'Structured teammate objective. Required when using structured brief fields instead of prompt.' },
    constraints: { type: 'string', required: false, description: 'Boundaries, exclusions, or safety constraints for the teammate.' },
    expected_output: { type: 'string', required: false, description: 'Expected result format or deliverable from the teammate.' },
    success_criteria: { type: 'string', required: false, description: 'Criteria the teammate should satisfy before reporting completion.' },
    maxTurns: { type: 'number', required: false, description: 'Deprecated compatibility field. Child agents now run until completion, cancellation, or failure.' },
  },
  async execute() {
    throw new Error('spawn_teammate is handled by TeamPlugin');
  },
};
