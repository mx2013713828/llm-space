export default {
  name: 'wait_for_teammates',
  description: 'Wait briefly for teammates to reach terminal states, then return team status and Lead inbox results.',
  parameters: {
    teamId: { type: 'string', required: false, description: 'Existing team id. Uses current team context when omitted.' },
    timeoutMs: { type: 'number', required: false, description: 'Maximum wait time in milliseconds. Defaults to 15000 and caps at 30000.' },
    pollIntervalMs: { type: 'number', required: false, description: 'Polling interval in milliseconds. Defaults to 500.' },
  },
  async execute() {
    throw new Error('wait_for_teammates is handled by TeamPlugin');
  },
};
