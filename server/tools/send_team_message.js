export default {
  name: 'send_team_message',
  description: 'Send a concise message to a teammate or the lead.',
  parameters: {
    teamId: { type: 'string', required: false, description: 'Existing team id. Uses current team context when omitted.' },
    to: { type: 'string', required: true, description: 'Recipient agent id.' },
    message: { type: 'string', required: true, description: 'Short message payload.' },
  },
  async execute() {
    throw new Error('send_team_message is handled by TeamPlugin');
  },
};
