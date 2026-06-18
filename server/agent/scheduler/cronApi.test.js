import test from 'node:test';
import assert from 'node:assert/strict';
import { createCronApiHandlers } from './cronApi.js';

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    }
  };
}

test('lists cron jobs scoped to the requested harness', async () => {
  const handlers = createCronApiHandlers({
    listJobs(harnessId) {
      return [{ id: 'cron_1', harnessId }];
    }
  });
  const res = createResponse();

  await handlers.list({ params: { harnessId: '01-chat-bot' } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, [{ id: 'cron_1', harnessId: '01-chat-bot' }]);
});

test('returns 400 when creating a job with an invalid cron expression', async () => {
  const handlers = createCronApiHandlers({
    async scheduleJob() {
      throw new Error('minute value must be between 0 and 59');
    }
  });
  const res = createResponse();

  await handlers.create({
    params: { harnessId: '01-chat-bot' },
    body: { cron: '61 * * * *', prompt: 'check build' }
  }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /minute/);
});
