import { promises as fs } from 'fs';
import path from 'path';

const cwd = globalThis.process?.cwd?.() || '.';

export const DEFAULT_CRON_STORE_PATH = path.join(cwd, 'server', 'scheduler', 'tasks.json');

export async function loadJobs(storePath = DEFAULT_CRON_STORE_PATH) {
  try {
    const raw = await fs.readFile(storePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function saveJobs(jobs, storePath = DEFAULT_CRON_STORE_PATH) {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, `${JSON.stringify(Array.isArray(jobs) ? jobs : [], null, 2)}\n`, 'utf-8');
}

export async function upsertJob(job, storePath = DEFAULT_CRON_STORE_PATH) {
  const jobs = await loadJobs(storePath);
  const index = jobs.findIndex(item => item.id === job.id);
  if (index === -1) {
    jobs.push(job);
  } else {
    jobs[index] = job;
  }
  await saveJobs(jobs, storePath);
  return jobs;
}

export async function deleteJob(jobId, storePath = DEFAULT_CRON_STORE_PATH) {
  const jobs = await loadJobs(storePath);
  const nextJobs = jobs.filter(job => job.id !== jobId);
  await saveJobs(nextJobs, storePath);
  return nextJobs;
}
