import { cronMatches, validateCron } from './cronExpression.js';
import { loadJobs, saveJobs } from './cronStore.js';

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function minuteMarker(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeJob(input, now) {
  return {
    id: input.id || makeId('cron'),
    harnessId: input.harnessId,
    cron: input.cron,
    prompt: input.prompt,
    recurring: input.recurring !== false,
    durable: input.durable !== false,
    enabled: input.enabled !== false,
    executionMode: input.executionMode || 'main',
    modelRef: input.modelRef || null,
    thinkingEnabled: input.thinkingEnabled === true,
    createdAt: input.createdAt || now.toISOString(),
    lastFiredAt: input.lastFiredAt || null
  };
}

export function createCronScheduler(options = {}) {
  const now = options.now || (() => new Date());
  const storePath = options.storePath;
  const jobs = new Map();
  const dueEvents = [];
  const lastFiredMarkers = new Map();
  const queuedJobIds = new Set();
  let timer = null;
  let persistenceQueue = Promise.resolve();

  const queuePersistence = () => {
    const durableJobs = [...jobs.values()].filter(job => job.durable);
    const write = () => saveJobs(durableJobs, storePath);
    persistenceQueue = persistenceQueue.then(write, write);
    return persistenceQueue;
  };

  const scheduler = {
    async loadDurableJobs() {
      const durableJobs = await loadJobs(storePath);
      for (const job of durableJobs) {
        if (!validateCron(job.cron) && job.harnessId && job.prompt) {
          jobs.set(job.id, normalizeJob(job, now()));
        }
      }
      return this.listJobs();
    },

    async scheduleJob(input) {
      const err = validateCron(input?.cron);
      if (err) throw new Error(err);
      if (!input?.harnessId) throw new Error('harnessId is required');
      if (!input?.prompt) throw new Error('prompt is required');

      const job = normalizeJob(input, now());
      jobs.set(job.id, job);
      if (job.durable) {
        await queuePersistence();
      }
      return job;
    },

    listJobs(harnessId) {
      const allJobs = [...jobs.values()];
      return harnessId ? allJobs.filter(job => job.harnessId === harnessId) : allJobs;
    },

    async cancelJob(jobId, harnessId) {
      const job = jobs.get(jobId);
      if (!job || (harnessId && job.harnessId !== harnessId)) return false;
      jobs.delete(jobId);
      queuedJobIds.delete(jobId);
      for (let index = dueEvents.length - 1; index >= 0; index--) {
        if (dueEvents[index].jobId === jobId) dueEvents.splice(index, 1);
      }
      if (job.durable) {
        await queuePersistence();
      }
      return true;
    },

    tick() {
      const currentDate = now();
      const marker = minuteMarker(currentDate);
      let durableStateChanged = false;

      for (const job of [...jobs.values()]) {
        try {
          if (!job.enabled || !cronMatches(job.cron, currentDate)) continue;
          if (lastFiredMarkers.get(job.id) === marker || queuedJobIds.has(job.id)) continue;

          const firedAt = currentDate.toISOString();
          job.lastFiredAt = firedAt;
          durableStateChanged ||= job.durable;
          lastFiredMarkers.set(job.id, marker);
          queuedJobIds.add(job.id);
          dueEvents.push({
            id: makeId('evt'),
            jobId: job.id,
            harnessId: job.harnessId,
            prompt: job.prompt,
            executionMode: job.executionMode,
            firedAt,
            modelRef: job.modelRef,
            thinkingEnabled: job.thinkingEnabled
          });

          if (!job.recurring) {
            jobs.delete(job.id);
          }
        } catch (err) {
          console.error(`[cron scheduler] failed to tick job ${job.id}:`, err);
        }
      }
      if (durableStateChanged) {
        queuePersistence().catch(err => console.error('[cron scheduler] persist failed:', err));
      }
    },

    drainDueEvents(limit = dueEvents.length) {
      const drained = dueEvents.splice(0, limit);
      for (const event of drained) {
        queuedJobIds.delete(event.jobId);
      }
      return drained;
    },

    requeueDueEvents(events) {
      const validEvents = Array.isArray(events) ? events.filter(Boolean) : [];
      for (const event of validEvents) {
        queuedJobIds.add(event.jobId);
      }
      dueEvents.unshift(...validEvents);
    },

    async persist() {
      await queuePersistence();
    },

    start(intervalMs = 1000) {
      if (timer) return;
      timer = setInterval(() => {
        this.tick();
      }, intervalMs);
      timer.unref?.();
    },

    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }
  };

  return scheduler;
}

export const cronScheduler = createCronScheduler();
