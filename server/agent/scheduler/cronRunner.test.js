import test from 'node:test';
import assert from 'node:assert/strict';
import { processScheduledEvents, runScheduledEvent } from './cronRunner.js';

test('requeues scheduled events while the target harness is active', async () => {
  const requeued = [];
  const scheduler = {
    drainDueEvents() {
      return [{
        id: 'evt_1',
        jobId: 'cron_1',
        harnessId: '01-chat-bot',
        prompt: 'check build',
        executionMode: 'main',
        firedAt: '2026-06-17T09:00:00.000Z',
        modelRef: null
      }];
    },
    requeueDueEvents(events) {
      requeued.push(...events);
    }
  };
  const activeJobs = new Map([['01-chat-bot', { clients: new Set() }]]);
  let ran = false;

  await processScheduledEvents({
    scheduler,
    activeJobs,
    runEvent: async () => {
      ran = true;
    }
  });

  assert.equal(ran, false);
  assert.equal(requeued.length, 1);
  assert.equal(requeued[0].id, 'evt_1');
});

test('runs scheduled events when the target harness is idle', async () => {
  const scheduler = {
    drainDueEvents() {
      return [{
        id: 'evt_1',
        jobId: 'cron_1',
        harnessId: '01-chat-bot',
        prompt: 'check build',
        executionMode: 'main',
        firedAt: '2026-06-17T09:00:00.000Z',
        modelRef: null
      }];
    },
    requeueDueEvents() {
      throw new Error('should not requeue idle event');
    }
  };
  const activeJobs = new Map();
  const ranEvents = [];

  await processScheduledEvents({
    scheduler,
    activeJobs,
    runEvent: async (event) => {
      ranEvents.push(event);
    }
  });

  assert.equal(ranEvents.length, 1);
  assert.equal(ranEvents[0].id, 'evt_1');
});

test('reserves a harness before awaiting scheduled event startup', async () => {
  const event = {
    id: 'evt_1',
    jobId: 'cron_1',
    harnessId: '01-chat-bot',
    prompt: 'check build'
  };
  const requeued = [];
  let drains = 0;
  const scheduler = {
    drainDueEvents() {
      drains += 1;
      return drains <= 2 ? [{ ...event, id: `evt_${drains}` }] : [];
    },
    requeueDueEvents(events) {
      requeued.push(...events);
    }
  };
  const activeJobs = new Map();
  let releaseFirst;
  const firstRun = new Promise(resolve => {
    releaseFirst = resolve;
  });
  let runCount = 0;
  const runEvent = async () => {
    runCount += 1;
    await firstRun;
  };

  const firstProcessor = processScheduledEvents({ scheduler, activeJobs, runEvent });
  await Promise.resolve();
  await processScheduledEvents({ scheduler, activeJobs, runEvent });

  assert.equal(runCount, 1);
  assert.equal(requeued.length, 1);
  releaseFirst();
  await firstProcessor;
  assert.equal(activeJobs.size, 0);
});

test('passes the scheduled thinking setting to the executor', async () => {
  let executorOptions;
  class FakeExecutor {
    constructor(options) {
      executorOptions = options;
    }

    async run() {}
  }

  await runScheduledEvent({
    id: 'evt_1',
    jobId: 'cron_1',
    harnessId: '01-chat-bot',
    prompt: 'check build',
    modelRef: 'deepseek',
    thinkingEnabled: true
  }, {
    activeJobs: new Map(),
    loadHarness: async () => ({ id: '01-chat-bot' }),
    loadSession: async () => ({ messages: [] }),
    resolveModel: async () => ({ id: 'deepseek' }),
    ExecutorClass: FakeExecutor
  });

  assert.equal(executorOptions.thinkingEnabled, true);
});

test('closes attached clients when scheduled execution finishes', async () => {
  let ended = false;
  class FakeExecutor {
    async run() {}
  }
  const reservation = {
    clients: new Set([{ end() { ended = true; } }])
  };

  await runScheduledEvent({
    id: 'evt_1',
    jobId: 'cron_1',
    harnessId: '01-chat-bot',
    prompt: 'check build',
    modelRef: 'deepseek'
  }, {
    activeJobs: new Map(),
    reservation,
    loadHarness: async () => ({ id: '01-chat-bot' }),
    loadSession: async () => ({ messages: [] }),
    resolveModel: async () => ({ id: 'deepseek' }),
    ExecutorClass: FakeExecutor
  });

  assert.equal(ended, true);
});

test('updates scheduler lifecycle around a successful execution', async () => {
  const calls = [];
  const event = { id: 'evt_1', jobId: 'cron_1', harnessId: '01-chat-bot', prompt: 'check build' };
  const scheduler = {
    drainDueEvents: () => [event],
    requeueDueEvents() {},
    async markEventStarted() { calls.push('started'); },
    async markEventSucceeded() { calls.push('succeeded'); },
    async markEventFailed() { calls.push('failed'); }
  };

  await processScheduledEvents({
    scheduler,
    activeJobs: new Map(),
    runEvent: async () => calls.push('run')
  });

  assert.deepEqual(calls, ['started', 'run', 'succeeded']);
});

test('records a failed scheduled execution', async () => {
  const calls = [];
  const error = new Error('model unavailable');
  const scheduler = {
    drainDueEvents: () => [{ id: 'evt_1', jobId: 'cron_1', harnessId: '01-chat-bot', prompt: 'check build' }],
    requeueDueEvents() {},
    async markEventStarted() { calls.push('started'); },
    async markEventSucceeded() { calls.push('succeeded'); },
    async markEventFailed(event, receivedError) {
      calls.push(`failed:${receivedError.message}`);
    }
  };

  await assert.rejects(() => processScheduledEvents({
    scheduler,
    activeJobs: new Map(),
    runEvent: async () => { throw error; }
  }), /model unavailable/);

  assert.deepEqual(calls, ['started', 'failed:model unavailable']);
});
