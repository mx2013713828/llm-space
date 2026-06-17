export default {
  name: 'cancel_cron',
  description: 'Cancel a scheduled cron job for the current harness.',
  parameters: {
    id: { type: 'string', description: 'The scheduled cron job id to cancel.', required: true }
  },
  async execute() {
    return '[cancel_cron intercepted by CronSchedulerPlugin]';
  }
};
