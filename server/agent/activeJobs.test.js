import test from 'node:test';
import assert from 'node:assert/strict';

import { createActiveJobRegistry } from './activeJobs.js';

test('active job registry reserves a harness before async work starts', () => {
  const registry = createActiveJobRegistry();

  const first = registry.reserve('h1', { source: 'agent' });
  const second = registry.reserve('h1', { source: 'agent' });

  assert.equal(first.reserved, true);
  assert.equal(second.reserved, false);
  assert.equal(second.job, first.job);
  assert.equal(registry.has('h1'), true);
  assert.deepEqual(registry.list(), [{ harnessId: 'h1', source: 'agent', clientCount: 0, hasExecutor: false }]);
});

test('active job registry attaches clients, broadcasts, and releases', () => {
  const registry = createActiveJobRegistry();
  const { job } = registry.reserve('h1', { source: 'agent' });
  const events = [];
  const client = {
    ended: false,
    end() {
      this.ended = true;
    },
  };

  registry.attach('h1', client);
  registry.setExecutor('h1', { messages: [], todos: [] });
  registry.broadcast('h1', 'done', { ok: true }, (target, type, data) => {
    events.push({ target, type, data });
  });
  const released = registry.release('h1');

  assert.equal(job.clients.has(client), false);
  assert.equal(released, job);
  assert.equal(client.ended, true);
  assert.deepEqual(events, [{ target: client, type: 'done', data: { ok: true } }]);
  assert.equal(registry.has('h1'), false);
});
