import { cronMatches, validateCron } from './cronExpression.js';
import { loadJobs, saveJobs } from './cronStore.js';
import { loadRuns, saveRuns } from './cronRunStore.js';

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
    status: input.status || 'idle',
    attemptCount: Number(input.attemptCount) || 0,
    runCount: Number(input.runCount) || 0,
    failureCount: Number(input.failureCount) || 0,
    lastFiredAt: input.lastFiredAt || null,
    lastStartedAt: input.lastStartedAt || null,
    lastSucceededAt: input.lastSucceededAt || null,
    lastFailedAt: input.lastFailedAt || null,
    lastError: input.lastError || null
  };
}

export function createCronScheduler(options = {}) {
  const now = options.now || (() => new Date());
  const storePath = options.storePath;
  const runStorePath = options.runStorePath;
  const maxRunHistory = options.maxRunHistory || 500;
  const jobs = new Map();
  const runs = [];
  const runIdsByEvent = new Map();
  const dueEvents = [];
  const lastFiredMarkers = new Map();
  const queuedJobIds = new Set();
  let timer = null;
  let persistenceQueue = Promise.resolve();
  let runPersistenceQueue = Promise.resolve();

  const queuePersistence = () => {
    const durableJobs = [...jobs.values()].filter(job => job.durable);
    const write = () => saveJobs(durableJobs, storePath);
    persistenceQueue = persistenceQueue.then(write, write);
    return persistenceQueue;
  };

  const queueRunPersistence = () => {
    const snapshot = runs.map(run => ({ ...run }));
    const write = () => saveRuns(snapshot, runStorePath);
    runPersistenceQueue = runPersistenceQueue.then(write, write);
    return runPersistenceQueue;
  };

  const updateEventJob = async (event, update, timestamp = now().toISOString()) => {
    const job = jobs.get(event?.jobId);
    if (!job) return null;
    update(job, timestamp);
    if (job.durable) await queuePersistence();
    return job;
  };

  const findEventRun = (event) => {
    const runId = runIdsByEvent.get(event?.id);
    return runId ? runs.find(run => run.id === runId) : null;
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

    async loadRunHistory() {
      const storedRuns = await loadRuns(runStorePath);
      const interruptedAt = now().toISOString();
      let changed = false;
      let jobStateChanged = false;
      for (const storedRun of storedRuns.slice(-maxRunHistory)) {
        const run = { ...storedRun };
        if (run.status === 'running') {
          run.status = 'interrupted';
          run.completedAt = interruptedAt;
          run.durationMs = Math.max(0, Date.parse(interruptedAt) - Date.parse(run.startedAt));
          run.error = 'Server restarted before the scheduled run completed';
          changed = true;
          const job = jobs.get(run.jobId);
          if (job?.status === 'running') {
            job.status = 'interrupted';
            job.lastFailedAt = interruptedAt;
            job.lastError = run.error;
            jobStateChanged = true;
          }
        }
        runs.push(run);
        if (run.eventId) runIdsByEvent.set(run.eventId, run.id);
      }
      if (changed) await queueRunPersistence();
      if (jobStateChanged) await queuePersistence();
      return this.listRuns();
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

    listRuns(harnessId, { jobId, limit = 25 } = {}) {
      const safeLimit = Math.max(1, Math.min(Number(limit) || 25, 100));
      return runs
        .filter(run => (!harnessId || run.harnessId === harnessId) && (!jobId || run.jobId === jobId))
        .slice()
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, safeLimit);
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

    async markEventStarted(event) {
      const timestamp = now().toISOString();
      const job = jobs.get(event?.jobId);
      if (job) {
        job.status = 'running';
        job.attemptCount += 1;
        job.lastStartedAt = timestamp;
        job.lastError = null;
      }
      const run = {
        id: makeId('run'),
        eventId: event.id,
        jobId: event.jobId,
        harnessId: event.harnessId,
        prompt: event.prompt,
        status: 'running',
        triggeredAt: event.firedAt || timestamp,
        startedAt: timestamp,
        completedAt: null,
        durationMs: null,
        error: null
      };
      runs.push(run);
      runIdsByEvent.set(event.id, run.id);
      if (runs.length > maxRunHistory) runs.splice(0, runs.length - maxRunHistory);
      await queueRunPersistence();

      if (!job) return null;
      if (!job.recurring) {
        jobs.delete(job.id);
      }
      if (job.durable) {
        await queuePersistence();
      }
      return job;
    },

    async markEventSkipped(event) {
      const timestamp = now().toISOString();
      return updateEventJob(event, (targetJob) => {
        targetJob.status = 'idle';
        targetJob.lastError = null;
      }, timestamp);
    },

    async markEventSucceeded(event) {
      const timestamp = now().toISOString();
      const job = await updateEventJob(event, (targetJob) => {
        targetJob.status = 'succeeded';
        targetJob.runCount += 1;
        targetJob.lastSucceededAt = timestamp;
        targetJob.lastError = null;
      }, timestamp);
      const run = findEventRun(event);
      if (run) {
        run.status = 'succeeded';
        run.completedAt = timestamp;
        run.durationMs = Math.max(0, Date.parse(timestamp) - Date.parse(run.startedAt));
        await queueRunPersistence();
      }
      return job;
    },

    async markEventFailed(event, error) {
      const timestamp = now().toISOString();
      const errorMessage = error?.message || String(error || 'Unknown scheduled execution error');
      const job = await updateEventJob(event, (targetJob) => {
        targetJob.status = 'failed';
        targetJob.failureCount += 1;
        targetJob.lastFailedAt = timestamp;
        targetJob.lastError = errorMessage;
      }, timestamp);
      const run = findEventRun(event);
      if (run) {
        run.status = 'failed';
        run.completedAt = timestamp;
        run.durationMs = Math.max(0, Date.parse(timestamp) - Date.parse(run.startedAt));
        run.error = errorMessage;
        await queueRunPersistence();
      }
      return job;
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
          job.status = 'queued';
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
      await queueRunPersistence();
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
