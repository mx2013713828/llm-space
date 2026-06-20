import { promises as fs } from 'fs';
import path from 'path';

const cwd = globalThis.process?.cwd?.() || '.';

export const DEFAULT_CRON_RUN_STORE_PATH = path.join(cwd, 'server', 'scheduler', 'runs.json');

export async function loadRuns(storePath = DEFAULT_CRON_RUN_STORE_PATH) {
  try {
    const raw = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveRuns(runs, storePath = DEFAULT_CRON_RUN_STORE_PATH) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(Array.isArray(runs) ? runs : [], null, 2)}\n`, 'utf-8');
}
