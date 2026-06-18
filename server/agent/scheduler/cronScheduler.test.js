import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCronScheduler } from './cronScheduler.js';

test('enqueues one event per job per minute', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'check build',
    recurring: true,
    durable: false,
    modelRef: null
  });

  scheduler.tick();
  scheduler.tick();

  const events = scheduler.drainDueEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].prompt, 'check build');
  assert.equal(events[0].executionMode, 'main');
  assert.equal(events[0].thinkingEnabled, false);
});

test('propagates thinkingEnabled from jobs to scheduled events', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'think deeply',
    recurring: true,
    durable: false,
    thinkingEnabled: true
  });

  scheduler.tick();

  assert.equal(scheduler.drainDueEvents()[0].thinkingEnabled, true);
});

test('serializes durable mutations without dropping concurrent jobs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-scheduler-'));
  const storePath = path.join(directory, 'tasks.json');
  const scheduler = createCronScheduler({ storePath });

  await Promise.all([
    scheduler.scheduleJob({ harnessId: 'first', cron: '* * * * *', prompt: 'first' }),
    scheduler.scheduleJob({ harnessId: 'second', cron: '* * * * *', prompt: 'second' })
  ]);
  await scheduler.persist();

  const persisted = JSON.parse(await fs.readFile(storePath, 'utf-8'));
  assert.deepEqual(persisted.map(job => job.harnessId).sort(), ['first', 'second']);
});

test('scopes listing and cancellation by harness', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  const first = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'first',
    recurring: true,
    durable: false
  });
  await scheduler.scheduleJob({
    harnessId: '02-bash',
    cron: '0 9 * * *',
    prompt: 'second',
    recurring: true,
    durable: false
  });

  assert.equal(scheduler.listJobs('01-chat-bot').length, 1);
  assert.equal(await scheduler.cancelJob(first.id, '02-bash'), false);
  assert.equal(await scheduler.cancelJob(first.id, '01-chat-bot'), true);
  assert.equal(scheduler.listJobs('01-chat-bot').length, 0);
});

test('removes one-shot jobs after firing', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'one shot',
    recurring: false,
    durable: false
  });

  scheduler.tick();

  assert.equal(scheduler.drainDueEvents().length, 1);
  assert.equal(scheduler.listJobs('01-chat-bot').length, 0);
});

test('tracks queued, running, and successful execution separately', async () => {
  const times = [
    new Date('2026-06-17T09:00:10+08:00'),
    new Date('2026-06-17T09:00:11+08:00'),
    new Date('2026-06-17T09:00:12+08:00')
  ];
  let timeIndex = 0;
  const scheduler = createCronScheduler({ now: () => times[Math.min(timeIndex++, times.length - 1)] });
  const job = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'check build',
    durable: false
  });

  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];
  assert.equal(scheduler.listJobs()[0].status, 'queued');
  assert.equal(scheduler.listJobs()[0].runCount, 0);

  await scheduler.markEventStarted(event);
  assert.equal(scheduler.listJobs()[0].status, 'running');
  assert.equal(scheduler.listJobs()[0].attemptCount, 1);

  await scheduler.markEventSucceeded(event);
  const completed = scheduler.listJobs()[0];
  assert.equal(completed.id, job.id);
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.runCount, 1);
  assert.equal(completed.failureCount, 0);
  assert.ok(completed.lastSucceededAt);
});

test('records failed execution without counting it as a successful run', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'check build',
    durable: false
  });
  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];

  await scheduler.markEventStarted(event);
  await scheduler.markEventFailed(event, new Error('model unavailable'));

  const failed = scheduler.listJobs()[0];
  assert.equal(failed.status, 'failed');
  assert.equal(failed.runCount, 0);
  assert.equal(failed.failureCount, 1);
  assert.equal(failed.lastError, 'model unavailable');
});
