import test from 'node:test';
import assert from 'node:assert/strict';
import { processScheduledEvents } from './cronRunner.js';

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
