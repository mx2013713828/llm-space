import { cronScheduler } from '../scheduler/cronScheduler.js';

const CRON_TOOLS = new Set(['schedule_cron', 'list_crons', 'cancel_cron']);

function formatJob(job) {
  return [
    `- ${job.id}: ${job.cron}`,
    `  prompt: ${job.prompt}`,
    `  recurring: ${job.recurring}`,
    `  durable: ${job.durable}`,
    `  enabled: ${job.enabled}`,
    `  lastFiredAt: ${job.lastFiredAt || 'never'}`
  ].join('\n');
}

export function createCronSchedulerPlugin(scheduler = cronScheduler) {
  return {
    name: 'CronSchedulerPlugin',

    async preToolUse(context) {
      const { executor, tool } = context;
      if (!tool || !CRON_TOOLS.has(tool.toolName)) return;

      const harnessId = executor?.harnessId || 'default';
      const args = tool.toolInput || {};

      try {
        if (tool.toolName === 'schedule_cron') {
          const job = await scheduler.scheduleJob({
            harnessId,
            cron: args.cron,
            prompt: args.prompt,
            recurring: args.recurring !== false,
            durable: args.durable !== false,
            modelRef: executor?.model?.id || null,
            thinkingEnabled: executor?.thinkingEnabled === true,
            executionMode: 'main'
          });
          tool.toolOutput = `[系统] 已创建定时任务 ${job.id}\ncron: ${job.cron}\nprompt: ${job.prompt}`;
        } else if (tool.toolName === 'list_crons') {
          const jobs = scheduler.listJobs(harnessId);
          tool.toolOutput = jobs.length > 0
            ? jobs.map(formatJob).join('\n\n')
            : '当前 Harness 没有定时任务。';
        } else if (tool.toolName === 'cancel_cron') {
          const ok = await scheduler.cancelJob(args.id, harnessId);
          tool.toolOutput = ok
            ? `[系统] 已取消定时任务 ${args.id}`
            : `[系统] 未找到当前 Harness 下的定时任务 ${args.id}`;
        }
      } catch (err) {
        tool.toolOutput = `[定时任务工具错误]\n${err.message}`;
      }

      tool.handled = true;
    }
  };
}

export const CronSchedulerPlugin = createCronSchedulerPlugin();
