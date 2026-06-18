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

test('reports successful and failed run counts without guessing from trigger time', async () => {
  const plugin = createCronSchedulerPlugin({
    listJobs() {
      return [{
        id: 'cron_123',
        cron: '*/3 * * * *',
        prompt: 'weather',
        recurring: true,
        durable: true,
        enabled: true,
        status: 'failed',
        attemptCount: 2,
        runCount: 1,
        failureCount: 1,
        lastFiredAt: '2026-06-18T01:51:00.000Z',
        lastSucceededAt: '2026-06-18T01:48:02.000Z',
        lastError: 'model unavailable'
      }];
    }
  });
  const tool = { toolName: 'list_crons', toolInput: {} };

  await plugin.preToolUse({ executor: { harnessId: '01-chat-bot' }, tool });

  assert.match(tool.toolOutput, /successfulRuns: 1/);
  assert.match(tool.toolOutput, /failedRuns: 1/);
  assert.match(tool.toolOutput, /status: failed/);
  assert.match(tool.toolOutput, /lastError: model unavailable/);
});
