import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCronScheduler } from './cronScheduler.js';
import { saveJobs } from './cronStore.js';
import { saveRuns } from './cronRunStore.js';

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

test('queues one-shot jobs after firing without removing them', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  const job = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'one shot',
    recurring: false,
    durable: false
  });

  scheduler.tick();

  assert.equal(scheduler.drainDueEvents().length, 1);
  assert.equal(scheduler.listJobs('01-chat-bot').length, 1);
  assert.equal(scheduler.listJobs('01-chat-bot')[0].id, job.id);
});

test('keeps one-shot jobs registered after tick until execution starts', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  const job = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'one shot',
    recurring: false,
    durable: false
  });

  scheduler.tick();

  assert.equal(scheduler.drainDueEvents().length, 1);
  assert.equal(scheduler.listJobs('01-chat-bot').length, 1);
  assert.equal(scheduler.listJobs('01-chat-bot')[0].id, job.id);
  assert.equal(scheduler.listJobs('01-chat-bot')[0].status, 'queued');
});

test('markEventStarted removes one-shot jobs after recording the running run', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'one shot',
    recurring: false,
    durable: false
  });

  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];

  await scheduler.markEventStarted(event);

  assert.equal(scheduler.listJobs('01-chat-bot').length, 0);
  const [run] = scheduler.listRuns('01-chat-bot');
  assert.equal(run.eventId, event.id);
  assert.equal(run.status, 'running');
});

test('removes durable one-shot jobs before run persistence can yield', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-one-shot-'));
  const storePath = path.join(directory, 'tasks.json');
  const runStorePath = path.join(directory, 'runs.json');
  const scheduler = createCronScheduler({
    now: () => new Date('2026-06-17T09:00:10+08:00'),
    storePath,
    runStorePath
  });
  const job = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'durable one shot',
    recurring: false,
    durable: true
  });

  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];
  await scheduler.persist();

  const originalWriteFile = fs.writeFile;
  const writeOrder = [];
  let releaseRunWrite;
  const runWritePaused = new Promise(resolve => {
    releaseRunWrite = resolve;
  });

  fs.writeFile = async (filePath, ...args) => {
    writeOrder.push(filePath);
    if (filePath === runStorePath) {
      await runWritePaused;
    }
    return originalWriteFile.call(fs, filePath, ...args);
  };

  try {
    const started = scheduler.markEventStarted(event);

    assert.equal(scheduler.listJobs('01-chat-bot').length, 0);

    scheduler.tick();
    assert.equal(scheduler.drainDueEvents().length, 0);

    releaseRunWrite();
    await started;

    assert.equal(scheduler.listJobs('01-chat-bot').length, 0);
    assert.equal(scheduler.listRuns('01-chat-bot')[0].eventId, event.id);
    assert.equal(writeOrder[0], storePath);
    assert.equal(writeOrder[1], runStorePath);
    assert.equal(job.id, event.jobId);
  } finally {
    fs.writeFile = originalWriteFile;
  }
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

test('markEventSkipped restores recurring jobs to idle without counting a run', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  const job = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'check build',
    recurring: true,
    durable: false
  });

  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];

  await scheduler.markEventSkipped(event);

  const [skipped] = scheduler.listJobs('01-chat-bot');
  assert.equal(skipped.id, job.id);
  assert.equal(skipped.status, 'idle');
  assert.equal(skipped.attemptCount, 0);
  assert.equal(skipped.runCount, 0);
  assert.equal(skipped.failureCount, 0);
  assert.equal(scheduler.listRuns('01-chat-bot').length, 0);
});

test('markEventSkipped restores one-shot jobs to idle without deleting them', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  const job = await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'one shot',
    recurring: false,
    durable: false
  });

  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];

  await scheduler.markEventSkipped(event);

  const [skipped] = scheduler.listJobs('01-chat-bot');
  assert.equal(skipped.id, job.id);
  assert.equal(skipped.status, 'idle');
  assert.equal(skipped.attemptCount, 0);
  assert.equal(skipped.runCount, 0);
  assert.equal(skipped.failureCount, 0);
  assert.equal(scheduler.listRuns('01-chat-bot').length, 0);
});

test('records successful execution history with duration', async () => {
  const times = [
    new Date('2026-06-20T08:59:59.000Z'),
    new Date('2026-06-20T09:00:00.000Z'),
    new Date('2026-06-20T09:00:00.000Z'),
    new Date('2026-06-20T09:00:02.500Z')
  ];
  let timeIndex = 0;
  const scheduler = createCronScheduler({ now: () => times[Math.min(timeIndex++, times.length - 1)] });
  await scheduler.scheduleJob({
    harnessId: 'weather',
    cron: '* * * * *',
    prompt: 'check weather',
    durable: false
  });
  scheduler.tick();
  const event = scheduler.drainDueEvents()[0];

  await scheduler.markEventStarted(event);
  await scheduler.markEventSucceeded(event);

  const [run] = scheduler.listRuns('weather');
  assert.equal(run.jobId, event.jobId);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.durationMs, 2500);
  assert.equal(run.error, null);
});

test('records failed runs and filters history by job', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-20T09:00:00.000Z') });
  const first = await scheduler.scheduleJob({ harnessId: 'weather', cron: '* * * * *', prompt: 'first', durable: false });
  const second = await scheduler.scheduleJob({ harnessId: 'weather', cron: '* * * * *', prompt: 'second', durable: false });
  scheduler.tick();
  const events = scheduler.drainDueEvents();

  await scheduler.markEventStarted(events[0]);
  await scheduler.markEventFailed(events[0], new Error('provider timeout'));
  await scheduler.markEventStarted(events[1]);
  await scheduler.markEventSucceeded(events[1]);

  const runs = scheduler.listRuns('weather', { jobId: first.id, limit: 10 });
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].error, 'provider timeout');
  assert.equal(scheduler.listRuns('weather', { jobId: second.id }).length, 1);
});

test('marks stale running jobs and history as interrupted after restart', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-restart-'));
  const storePath = path.join(directory, 'tasks.json');
  const runStorePath = path.join(directory, 'runs.json');
  await saveJobs([{
    id: 'cron_1',
    harnessId: 'weather',
    cron: '* * * * *',
    prompt: 'weather',
    durable: true,
    status: 'running'
  }], storePath);
  await saveRuns([{
    id: 'run_1',
    eventId: 'evt_1',
    jobId: 'cron_1',
    harnessId: 'weather',
    status: 'running',
    startedAt: '2026-06-20T09:00:00.000Z'
  }], runStorePath);
  const scheduler = createCronScheduler({
    storePath,
    runStorePath,
    now: () => new Date('2026-06-20T09:00:05.000Z')
  });

  await scheduler.loadDurableJobs();
  await scheduler.loadRunHistory();

  assert.equal(scheduler.listJobs('weather')[0].status, 'interrupted');
  assert.equal(scheduler.listRuns('weather')[0].status, 'interrupted');
  assert.equal(scheduler.listRuns('weather')[0].durationMs, 5000);
});
