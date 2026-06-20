import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRuns, saveRuns } from './cronRunStore.js';

test('persists scheduled execution history as pretty JSON', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cron-runs-'));
  const storePath = path.join(directory, 'runs.json');
  const runs = [{ id: 'run_1', jobId: 'cron_1', status: 'succeeded' }];

  assert.deepEqual(await loadRuns(storePath), []);
  await saveRuns(runs, storePath);

  assert.deepEqual(await loadRuns(storePath), runs);
  assert.match(await fs.readFile(storePath, 'utf-8'), /\n {2}\{/);
});
