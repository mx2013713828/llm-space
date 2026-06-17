import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadJobs, upsertJob, deleteJob } from './cronStore.js';

test('stores, loads, and deletes durable jobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cron-store-'));
  const storePath = join(dir, 'tasks.json');
  const job = {
    id: 'cron_1',
    harnessId: '01-chat-bot',
    cron: '*/5 * * * *',
    prompt: 'run date',
    recurring: true,
    durable: true,
    enabled: true,
    executionMode: 'main',
    modelRef: null,
    createdAt: '2026-06-17T00:00:00.000Z',
    lastFiredAt: null
  };

  assert.deepEqual(await loadJobs(storePath), []);
  await upsertJob(job, storePath);
  assert.deepEqual(await loadJobs(storePath), [job]);
  await deleteJob('cron_1', storePath);
  assert.deepEqual(await loadJobs(storePath), []);
  assert.deepEqual(JSON.parse(await readFile(storePath, 'utf-8')), []);
  await rm(dir, { recursive: true, force: true });
});
