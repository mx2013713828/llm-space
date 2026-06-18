import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHarnessSession } from './sessionApi.js';

test('fetches the persisted session for a harness', async () => {
  const session = { messages: [{ content: 'scheduled result' }], todos: [], backgroundTasks: [] };
  const result = await fetchHarnessSession('weather bot', async (url) => {
    assert.equal(url, 'http://localhost:3001/api/sessions/weather%20bot');
    return { ok: true, json: async () => session };
  });

  assert.deepEqual(result, session);
});
