import { promises as fs } from 'fs';
import path from 'path';
import { AgentExecutor } from '../AgentExecutor.js';
import { resolveModelConfig } from './modelResolver.js';

const cwd = globalThis.process?.cwd?.() || '.';
const DEFAULT_HARNESS_DIR = path.join(cwd, 'harnesses');
const DEFAULT_SESSIONS_DIR = path.join(cwd, 'server', 'sessions');

async function loadHarness(harnessId, harnessDir = DEFAULT_HARNESS_DIR) {
  if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
    throw new Error(`Invalid harnessId: ${harnessId}`);
  }
  const files = await fs.readdir(harnessDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const content = await fs.readFile(path.join(harnessDir, file), 'utf-8');
    const harness = JSON.parse(content);
    if (harness.id === harnessId) return harness;
  }
  throw new Error(`Harness not found: ${harnessId}`);
}

async function loadSession(harnessId, sessionsDir = DEFAULT_SESSIONS_DIR) {
  const sessionPath = path.join(sessionsDir, `${harnessId}.json`);
  const content = await fs.readFile(sessionPath, 'utf-8').catch(err => {
    if (err.code === 'ENOENT') return null;
    throw err;
  });
  return content ? JSON.parse(content) : { messages: [], todos: [], backgroundTasks: [] };
}

function nextTurn(messages) {
  const turns = messages.map(msg => Number(msg.turn) || 1);
  return turns.length > 0 ? Math.max(...turns) + 1 : 1;
}

async function updateSchedulerLifecycle(scheduler, method, ...args) {
  try {
    await scheduler?.[method]?.(...args);
  } catch (err) {
    console.error(`[cron runner] failed to record ${method}:`, err);
  }
}

export async function runScheduledEvent(event, {
  activeJobs,
  broadcastEvent = () => {},
  harnessDir,
  sessionsDir,
  loadHarness: loadHarnessFn = loadHarness,
  loadSession: loadSessionFn = loadSession,
  resolveModel = resolveModelConfig,
  reservation,
  ExecutorClass = AgentExecutor,
} = {}) {
  const harness = await loadHarnessFn(event.harnessId, harnessDir);
  const session = await loadSessionFn(event.harnessId, sessionsDir);
  const model = await resolveModel(event.modelRef);
  const messages = Array.isArray(session.messages) ? [...session.messages] : [];
  const turn = nextTurn(messages);

  messages.push({
    role: 'user',
    type: 'scheduled',
    content: `[Scheduled] ${event.prompt}`,
    scheduledEventId: event.id,
    scheduledJobId: event.jobId,
    turn
  });

  const executor = new ExecutorClass({
    harnessId: event.harnessId,
    messages,
    todos: session.todos || [],
    backgroundTasks: session.backgroundTasks || [],
    systemPrompt: harness.systemPrompt || '',
    tools: harness.tools || [],
    features: harness.features || {},
    model,
    temperature: harness.model?.temperature ?? 1,
    maxTokens: harness.model?.max_tokens ?? 8192,
    thinkingEnabled: event.thinkingEnabled === true,
    skills: harness.skills || [],
    onEvent: (type, data) => broadcastEvent(event.harnessId, type, data)
  });

  const executionJob = { executor, clients: reservation?.clients || new Set(), source: 'cron' };
  activeJobs?.set(event.harnessId, executionJob);
  try {
    await executor.run();
  } finally {
    for (const client of executionJob.clients) {
      client.end?.();
    }
    if (activeJobs?.get(event.harnessId) === executionJob) {
      activeJobs.delete(event.harnessId);
    }
  }
}

export async function processScheduledEvents({
  scheduler,
  activeJobs,
  runEvent = (event, reservation) => runScheduledEvent(event, { activeJobs, reservation }),
  limit = 1,
} = {}) {
  const events = scheduler.drainDueEvents(limit);
  for (const event of events) {
    if (activeJobs?.has(event.harnessId)) {
      scheduler.requeueDueEvents([event]);
      continue;
    }
    const reservation = { executor: null, clients: new Set(), source: 'cron-reservation' };
    activeJobs?.set(event.harnessId, reservation);
    try {
      await updateSchedulerLifecycle(scheduler, 'markEventStarted', event);
      await runEvent(event, reservation);
      await updateSchedulerLifecycle(scheduler, 'markEventSucceeded', event);
    } catch (err) {
      await updateSchedulerLifecycle(scheduler, 'markEventFailed', event, err);
      throw err;
    } finally {
      if (activeJobs?.get(event.harnessId) === reservation) {
        activeJobs.delete(event.harnessId);
      }
    }
  }
}

export function startCronQueueProcessor({
  scheduler,
  activeJobs,
  broadcastEvent,
  intervalMs = 200,
} = {}) {
  const timer = setInterval(() => {
    processScheduledEvents({
      scheduler,
      activeJobs,
      runEvent: (event, reservation) => runScheduledEvent(event, {
        activeJobs,
        broadcastEvent,
        reservation
      })
    }).catch(err => console.error('[cron runner] failed to process scheduled event:', err));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
