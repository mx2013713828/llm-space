import test from 'node:test';
import assert from 'node:assert/strict';
import { createCronSchedulerPlugin } from './CronSchedulerPlugin.js';

test('intercepts schedule_cron and scopes the job to the current harness', async () => {
  const calls = [];
  const plugin = createCronSchedulerPlugin({
    async scheduleJob(input) {
      calls.push(input);
      return { id: 'cron_123', ...input };
    },
    listJobs() {
      return [];
    },
    async cancelJob() {
      return false;
    }
  });
  const tool = {
    toolName: 'schedule_cron',
    toolInput: {
      cron: '*/5 * * * *',
      prompt: 'check build',
      recurring: true,
      durable: false
    }
  };

  await plugin.preToolUse({
    executor: { harnessId: '01-chat-bot', model: { id: 'deepseek' }, thinkingEnabled: true },
    tool
  });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /cron_123/);
  assert.deepEqual(calls, [{
    harnessId: '01-chat-bot',
    cron: '*/5 * * * *',
    prompt: 'check build',
    recurring: true,
    durable: false,
    modelRef: 'deepseek',
    thinkingEnabled: true,
    executionMode: 'main'
  }]);
});
