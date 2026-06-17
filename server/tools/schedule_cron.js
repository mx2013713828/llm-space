export default {
  name: 'schedule_cron',
  description: 'Schedule a prompt to run automatically for the current harness using a five-field cron expression.',
  parameters: {
    cron: { type: 'string', description: 'Five-field cron expression, such as "*/5 * * * *" or "0 9 * * 1-5".', required: true },
    prompt: { type: 'string', description: 'The prompt to inject when the schedule fires.', required: true },
    recurring: { type: 'boolean', description: 'Whether the job repeats. Defaults to true.', required: false },
    durable: { type: 'boolean', description: 'Whether the job persists across server restarts. Defaults to true.', required: false }
  },
  async execute() {
    return '[schedule_cron intercepted by CronSchedulerPlugin]';
  }
};
