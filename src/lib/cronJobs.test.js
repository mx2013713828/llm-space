import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelCronJob, fetchCronJobs } from './cronJobs.js';

test('fetches cron jobs for a harness', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      async json() {
        return [{ id: 'cron_1' }];
      }
    };
  };

  assert.deepEqual(await fetchCronJobs('01-chat-bot', fetchImpl), [{ id: 'cron_1' }]);
  assert.deepEqual(calls, ['http://localhost:3001/api/harnesses/01-chat-bot/cron-jobs']);
});

test('cancels a cron job for a harness', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      async json() {
        return { success: true };
      }
    };
  };

  await cancelCronJob('01-chat-bot', 'cron_1', fetchImpl);
  assert.equal(calls[0].options.method, 'DELETE');
});
