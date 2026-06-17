export default {
  name: 'list_crons',
  description: 'List scheduled cron jobs for the current harness.',
  parameters: {},
  async execute() {
    return '[list_crons intercepted by CronSchedulerPlugin]';
  }
};
