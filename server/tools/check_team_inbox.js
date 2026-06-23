export default {
  name: 'check_team_inbox',
  description: 'Read and consume unread Lead team messages.',
  parameters: {
    teamId: { type: 'string', required: false, description: 'Existing team id. Uses current team context when omitted.' },
  },
  async execute() {
    throw new Error('check_team_inbox is handled by TeamPlugin');
  },
};
