# Cron Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-process cron scheduler so agents can create, list, cancel, and automatically execute scheduled tasks for a harness.

**Architecture:** Follow the OpenClaw-style split of Cron API, in-process Cron Engine, event queue, session routing, and Agent Runtime. MVP keeps execution bound to a `harnessId`, uses `activeJobs` as the per-harness busy lock, persists durable job definitions, and executes scheduled prompts through `AgentExecutor`.

**Tech Stack:** Node.js ESM, Express, existing `AgentExecutor`, existing tool registry and plugin system, Node test runner.

## Global Constraints

- Jobs are scoped to `harnessId`.
- MVP does not backfill tasks missed while the server process was stopped.
- Jobs store a model reference, not raw API keys; execution resolves the latest model config from `.env` / `MODELS_CONFIG`.
- MVP can be controlled through agent tools before building a dedicated UI panel.
- Cron syntax is five-field cron with `*`, `*/N`, `N`, `N-M`, and `N,M`.
- If a job fires while the same harness is already running, keep it queued until the harness is idle.
- If the same job fires again while a prior event for that job is queued or running, skip the duplicate trigger in MVP.

---

## File Structure

- Create `server/agent/scheduler/cronExpression.js`
  - Owns cron validation and matching.
- Create `server/agent/scheduler/cronStore.js`
  - Owns durable JSON storage at `server/scheduler/tasks.json`.
- Create `server/agent/scheduler/cronScheduler.js`
  - Owns in-memory jobs, fired event queue, duplicate suppression, and public scheduler API.
- Create `server/agent/scheduler/cronRunner.js`
  - Owns queue processing and scheduled `AgentExecutor` startup.
- Create `server/agent/scheduler/modelResolver.js`
  - Resolves model config references from `.env` without persisting secrets in cron jobs.
- Create `server/agent/plugins/CronSchedulerPlugin.js`
  - Intercepts cron tools and maps them to scheduler API calls.
- Create `server/tools/schedule_cron.js`
- Create `server/tools/list_crons.js`
- Create `server/tools/cancel_cron.js`
- Modify `server/tools/ToolRegistry.js`
  - Registers cron tool schemas.
- Modify `server/agent/AgentExecutor.js`
  - Auto-injects cron tools when the scheduler feature is enabled.
- Modify `server.js`
  - Starts the scheduler and queue processor on boot.
  - Adds minimal REST APIs for future UI visibility.
- Modify `src/lib/FeatureSchema.js`
  - Adds `enable_cron_scheduler`.
- Modify `src/components/MessageBubbles.jsx`
  - Renders scheduled user messages with a `Scheduled` badge.

---

## OpenClaw Reference Mapping

OpenClaw concept | LLM Space equivalent
--- | ---
Cron API | `schedule_cron`, `list_crons`, `cancel_cron`
Gateway Cron Engine | `server/agent/scheduler/cronScheduler.js`
Event Bus | in-process `ScheduledEvent` queue
Session Router | `harnessId` routing plus future `executionMode`
Agent Runtime | `AgentExecutor`

Design inspiration to keep:

- Use an event boundary: scheduler emits `ScheduledEvent`, runner consumes it.
- Reserve `executionMode: "main" | "isolated"` in job data, even if MVP only uses `"main"`.
- Keep everything in-process for now. No system crontab, systemd timer, webhooks, Redis, or external scheduler.

---

## Task 1: Cron Expression Matcher

**Files:**
- Create: `server/agent/scheduler/cronExpression.js`
- Test: `server/agent/scheduler/cronExpression.test.js`

**Interfaces:**
- Produces: `validateCron(cron: string): string | null`
- Produces: `cronMatches(cron: string, date: Date): boolean`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cronMatches, validateCron } from './cronExpression.js';

test('matches every five minutes', () => {
  assert.equal(cronMatches('*/5 * * * *', new Date('2026-06-17T09:10:00+08:00')), true);
  assert.equal(cronMatches('*/5 * * * *', new Date('2026-06-17T09:11:00+08:00')), false);
});

test('uses cron DOM and DOW OR semantics when both are constrained', () => {
  assert.equal(cronMatches('0 9 17 * 1', new Date('2026-06-17T09:00:00+08:00')), true);
});

test('rejects invalid cron expressions', () => {
  assert.match(validateCron('* * *'), /five fields/i);
  assert.match(validateCron('61 * * * *'), /minute/i);
  assert.equal(validateCron('0 9 * * 1-5'), null);
});
```

- [ ] **Step 2: Verify red**

Run: `node --test server/agent/scheduler/cronExpression.test.js`

Expected: fails because `cronExpression.js` does not exist.

- [ ] **Step 3: Implement matcher**

Implement five-field cron support with field ranges:

- minute `0-59`
- hour `0-23`
- day of month `1-31`
- month `1-12`
- day of week `0-7`, with `0` and `7` both treated as Sunday

- [ ] **Step 4: Verify green**

Run: `node --test server/agent/scheduler/cronExpression.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/agent/scheduler/cronExpression.js server/agent/scheduler/cronExpression.test.js
git commit -m "feat(scheduler): add cron expression matcher"
```

---

## Task 2: Durable Job Store

**Files:**
- Create: `server/agent/scheduler/cronStore.js`
- Test: `server/agent/scheduler/cronStore.test.js`

**Interfaces:**
- Produces: `loadJobs(storePath?: string): Promise<Array<CronJob>>`
- Produces: `saveJobs(jobs: Array<CronJob>, storePath?: string): Promise<void>`
- Produces: `upsertJob(job: CronJob, storePath?: string): Promise<Array<CronJob>>`
- Produces: `deleteJob(jobId: string, storePath?: string): Promise<Array<CronJob>>`

- [ ] **Step 1: Write failing tests**

```js
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
```

- [ ] **Step 2: Verify red**

Run: `node --test server/agent/scheduler/cronStore.test.js`

Expected: fails because `cronStore.js` does not exist.

- [ ] **Step 3: Implement JSON store**

Use `fs.mkdir(path.dirname(storePath), { recursive: true })` before writes. Return `[]` for missing files. Write pretty JSON with two-space indentation.

- [ ] **Step 4: Verify green**

Run: `node --test server/agent/scheduler/cronStore.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/agent/scheduler/cronStore.js server/agent/scheduler/cronStore.test.js
git commit -m "feat(scheduler): persist cron jobs"
```

---

## Task 3: Scheduler Engine and Event Queue

**Files:**
- Create: `server/agent/scheduler/cronScheduler.js`
- Test: `server/agent/scheduler/cronScheduler.test.js`

**Interfaces:**
- Produces: `createCronScheduler(options): CronScheduler`
- `CronScheduler.scheduleJob(input): Promise<CronJob>`
- `CronScheduler.listJobs(harnessId?: string): Array<CronJob>`
- `CronScheduler.cancelJob(jobId: string, harnessId?: string): Promise<boolean>`
- `CronScheduler.drainDueEvents(limit?: number): Array<ScheduledEvent>`
- `ScheduledEvent`: `{ id, jobId, harnessId, prompt, executionMode, firedAt, modelRef }`

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCronScheduler } from './cronScheduler.js';

test('enqueues one event per job per minute', async () => {
  const scheduler = createCronScheduler({ now: () => new Date('2026-06-17T09:00:10+08:00') });
  await scheduler.scheduleJob({
    harnessId: '01-chat-bot',
    cron: '0 9 * * *',
    prompt: 'check build',
    recurring: true,
    durable: false,
    modelRef: null
  });

  scheduler.tick();
  scheduler.tick();

  const events = scheduler.drainDueEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].prompt, 'check build');
  assert.equal(events[0].executionMode, 'main');
});
```

- [ ] **Step 2: Verify red**

Run: `node --test server/agent/scheduler/cronScheduler.test.js`

Expected: fails because `cronScheduler.js` does not exist.

- [ ] **Step 3: Implement scheduler**

Use `cronMatches()` and a `lastFiredMarker` map keyed by job id. The marker must include the date and minute: `YYYY-MM-DDTHH:mm`.

- [ ] **Step 4: Verify green**

Run: `node --test server/agent/scheduler/cronScheduler.test.js`

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/agent/scheduler/cronScheduler.js server/agent/scheduler/cronScheduler.test.js
git commit -m "feat(scheduler): enqueue scheduled events"
```

---

## Task 4: Cron Tools and Plugin

**Files:**
- Create: `server/tools/schedule_cron.js`
- Create: `server/tools/list_crons.js`
- Create: `server/tools/cancel_cron.js`
- Create: `server/agent/plugins/CronSchedulerPlugin.js`
- Modify: `server/tools/ToolRegistry.js`
- Modify: `server/agent/AgentExecutor.js`

**Interfaces:**
- Consumes: `createCronScheduler()` singleton exported by `cronScheduler.js`
- Produces tools: `schedule_cron`, `list_crons`, `cancel_cron`

- [ ] **Step 1: Write failing tests**

Add a plugin test that creates an executor-like object with `harnessId`, invokes `preToolUse` for `schedule_cron`, and asserts `tool.handled === true` plus `tool.toolOutput` contains the created job id.

- [ ] **Step 2: Verify red**

Run: `node --test server/agent/plugins/CronSchedulerPlugin.test.js`

Expected: fails because plugin does not exist.

- [ ] **Step 3: Implement tool schemas**

`schedule_cron` parameters:

```js
{
  cron: { type: 'string', required: true },
  prompt: { type: 'string', required: true },
  recurring: { type: 'boolean', required: false },
  durable: { type: 'boolean', required: false }
}
```

`list_crons` has no required parameters.

`cancel_cron` parameters:

```js
{
  id: { type: 'string', required: true }
}
```

- [ ] **Step 4: Implement plugin interception**

The plugin must scope every operation to `executor.harnessId`. It must set `tool.handled = true` for all three tools.

- [ ] **Step 5: Auto-inject tools**

Add `enable_cron_scheduler` under experimental features. When enabled, `AgentExecutor` pushes the three cron tool names into `this.tools`.

- [ ] **Step 6: Verify green**

Run:

```bash
node --test server/agent/plugins/CronSchedulerPlugin.test.js
npx eslint server/tools/schedule_cron.js server/tools/list_crons.js server/tools/cancel_cron.js server/agent/plugins/CronSchedulerPlugin.js server/tools/ToolRegistry.js server/agent/AgentExecutor.js
```

- [ ] **Step 7: Commit**

```bash
git add server/tools/schedule_cron.js server/tools/list_crons.js server/tools/cancel_cron.js server/agent/plugins/CronSchedulerPlugin.js server/tools/ToolRegistry.js server/agent/AgentExecutor.js src/lib/FeatureSchema.js
git commit -m "feat(agent): add cron scheduler tools"
```

---

## Task 5: Queue Processor and Automatic Agent Runs

**Files:**
- Create: `server/agent/scheduler/modelResolver.js`
- Create: `server/agent/scheduler/cronRunner.js`
- Modify: `server.js`

**Interfaces:**
- Consumes: `CronScheduler.drainDueEvents()`
- Produces: `startCronQueueProcessor({ scheduler, activeJobs, broadcastEvent }): void`

- [ ] **Step 1: Write failing tests**

Test that the runner skips an event when `activeJobs.has(harnessId)` is true and consumes it when idle.

- [ ] **Step 2: Verify red**

Run: `node --test server/agent/scheduler/cronRunner.test.js`

Expected: fails because runner does not exist.

- [ ] **Step 3: Implement model resolver**

Read `.env`, parse `MODELS_CONFIG` with existing `parseModelsConfig()`, and resolve by `modelRef`. If `modelRef` is null, use the first configured model.

- [ ] **Step 4: Implement scheduled message creation**

Append this message to the loaded session before execution:

```js
{
  role: 'user',
  type: 'scheduled',
  content: `[Scheduled] ${event.prompt}`,
  scheduledEventId: event.id,
  scheduledJobId: event.jobId,
  turn: nextTurn
}
```

- [ ] **Step 5: Start AgentExecutor**

Create `AgentExecutor` with harness config, saved session state, resolved model config, and `onEvent` that saves state even without SSE clients.

- [ ] **Step 6: Start services in `server.js`**

After `activeJobs` and `broadcastEvent` exist, call scheduler startup once:

```js
await cronScheduler.loadDurableJobs();
cronScheduler.start();
startCronQueueProcessor({ scheduler: cronScheduler, activeJobs, broadcastEvent });
```

- [ ] **Step 7: Verify green**

Run:

```bash
node --test server/agent/scheduler/cronRunner.test.js
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add server/agent/scheduler/modelResolver.js server/agent/scheduler/cronRunner.js server.js
git commit -m "feat(agent): process scheduled job queue"
```

---

## Task 6: Scheduled Message UI

**Files:**
- Modify: `src/components/MessageBubbles.jsx`
- Modify: `src/components/TrajectoryView.jsx` if message routing requires it

**Interfaces:**
- Consumes message shape `{ role: 'user', type: 'scheduled', content: string }`

- [ ] **Step 1: Write UI-oriented test or focused rendering check**

If no existing React test harness exists, add a small pure helper in `MessageBubbles.jsx` or a sibling module to classify user message variant and test that `type: 'scheduled'` maps to `scheduled`.

- [ ] **Step 2: Implement badge rendering**

Scheduled user messages should render like user messages with an additional `Scheduled` badge.

- [ ] **Step 3: Verify**

Run:

```bash
node --test src/lib/chatInput.test.js src/lib/markdown.test.js
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/MessageBubbles.jsx src/components/TrajectoryView.jsx
git commit -m "feat(ui): render scheduled messages"
```

---

## Task 7: Minimal REST APIs for Future UI

**Files:**
- Modify: `server.js`
- Test: use targeted integration-style tests if server route tests already exist; otherwise add route handlers as exported functions in a small module before wiring to Express.

**Interfaces:**
- Produces: `GET /api/harnesses/:harnessId/cron-jobs`
- Produces: `POST /api/harnesses/:harnessId/cron-jobs`
- Produces: `DELETE /api/harnesses/:harnessId/cron-jobs/:jobId`

- [ ] **Step 1: Add route handler tests**

Cover listing by harness and rejecting invalid cron.

- [ ] **Step 2: Implement routes**

Routes call the same scheduler API used by the plugin.

- [ ] **Step 3: Verify**

Run:

```bash
node --test server/agent/scheduler/*.test.js
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add server.js server/agent/scheduler
git commit -m "feat(api): expose scheduled job endpoints"
```

---

## Task 8: Scheduled Tasks Panel

**Files:**
- Create: `src/components/ScheduledTasksPanel.jsx`
- Modify: `src/components/TrajectoryView.jsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes REST APIs from Task 7.

- [ ] **Step 1: Add panel shell**

Add a right-side tab named `Scheduled`.

- [ ] **Step 2: Fetch jobs**

Fetch `GET /api/harnesses/:harnessId/cron-jobs` when the tab opens.

- [ ] **Step 3: Add cancel action**

Call `DELETE /api/harnesses/:harnessId/cron-jobs/:jobId`.

- [ ] **Step 4: Verify**

Run:

```bash
npx eslint src/components/ScheduledTasksPanel.jsx src/components/TrajectoryView.jsx
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/ScheduledTasksPanel.jsx src/components/TrajectoryView.jsx src/App.css
git commit -m "feat(ui): add scheduled tasks panel"
```

---

## Future Final-Form Enhancements

- Add `executionMode: "isolated"` to run scheduled jobs in a clean context.
- Add announce behavior for isolated runs so the result can be appended to the main harness session.
- Add `runAt` one-shot reminders as a first-class alternative to cron.
- Add `nextRunAt` preview.
- Add timezone selection per job.
- Add missed-run policy: `none`, `latest`, or capped backfill.
- Add run history with status, duration, error, and output summary.
- Add pause/resume for jobs.
- Add per-job concurrency policy: `skip`, `queue`, or `replace`.
- Add external scheduler integration only if we need tasks to run while the Node process is closed.

---

## Self-Review

- Spec coverage: the plan covers cron matching, durable storage, cron tools, queue processing, UI visibility, and future OpenClaw-style execution modes.
- Placeholder scan: no task depends on an unnamed module or unspecified path.
- Type consistency: `CronJob`, `ScheduledEvent`, `executionMode`, `harnessId`, and `modelRef` are consistently named across tasks.
