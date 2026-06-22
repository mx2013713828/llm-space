# Task Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy task-manager configuration with one Task Orchestration policy that owns planning tools, one-off Sub-agents, background execution, and Cron scheduling.

**Architecture:** A shared pure policy module normalizes all system-managed orchestration tools from the canonical `features.task_orchestration` group. `AgentExecutor`, Sub-agent execution, Cron eligibility, and the configuration UI consume that policy, while all checked-in Harnesses are hard-migrated with no legacy runtime compatibility.

**Tech Stack:** React 19, Node.js ES modules, Node test runner, Express, existing AgentExecutor/plugin lifecycle, existing Feature Schema renderer.

## Global Constraints

- Agent Teams, teammate lifecycle, and teammate messaging are outside this implementation.
- `sub_agent` remains synchronous and one-shot; do not add a background mode.
- Do not retain runtime compatibility for `task_manager`, top-level `enable_cron_scheduler`, or manually mounted orchestration tools.
- Disabling Task Orchestration disables every child capability without erasing stored child selections.
- Disabled Cron occurrences are skipped without history or counters and are never replayed; existing jobs are not deleted.
- Do not forcefully terminate Sub-agents, commands, or scheduled executions that already started.
- Add no third-party dependency and do not perform mobile-layout work.
- Follow TDD for every behavior change and create one Git commit after each task.

---

### Task 1: Canonical Feature Schema and Orchestration Policy

**Files:**
- Create: `src/lib/taskOrchestration.js`
- Create: `src/lib/taskOrchestration.test.js`
- Modify: `src/lib/FeatureSchema.js`
- Create: `src/lib/FeatureSchema.test.js`

**Interfaces:**
- Produces: `ORCHESTRATION_MANAGED_TOOL_NAMES: string[]`.
- Produces: `getToolName(tool): string` for string and object tool entries.
- Produces: `resolveOrchestrationTools(requestedTools, orchestration): Array<string|object>`.
- Produces: `isOrchestrationEnabled(orchestration, capability?): boolean`.
- Produces: canonical `FEATURE_SCHEMA.task_orchestration` with section metadata and preserved disabled children.

- [ ] **Step 1: Write failing policy tests**

Create tests that demonstrate the complete desired matrix:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  resolveOrchestrationTools,
} from './taskOrchestration.js';

test('removes every managed tool when orchestration is disabled', () => {
  const requested = ['bash', 'sub_agent', { name: 'schedule_cron' }, 'write_todos'];
  assert.deepEqual(resolveOrchestrationTools(requested, {
    enabled: false,
    mode: 'task_system',
    enable_sub_agents: true,
    enable_cron_scheduler: true,
  }), ['bash']);
});

test('mounts only the enabled orchestration capabilities without duplicates', () => {
  const result = resolveOrchestrationTools(['bash', 'sub_agent', 'bash'], {
    enabled: true,
    mode: 'task_system',
    enable_sub_agents: true,
    enable_background_tasks: true,
    enable_cron_scheduler: true,
  });
  assert.deepEqual(result, [
    'bash',
    'create_task', 'list_tasks', 'get_task', 'claim_task', 'complete_task',
    'sub_agent', 'query_background_tasks',
    'schedule_cron', 'list_crons', 'cancel_cron',
  ]);
  assert.equal(new Set(ORCHESTRATION_MANAGED_TOOL_NAMES).size, ORCHESTRATION_MANAGED_TOOL_NAMES.length);
});
```

Add separate assertions for `mode: 'todo'`, object-valued atomic tools, and individual child switches.

- [ ] **Step 2: Write failing Feature Schema tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_SCHEMA, parseFeatures } from './FeatureSchema.js';

test('exposes canonical task orchestration sections', () => {
  const group = FEATURE_SCHEMA.task_orchestration;
  assert.equal(group.label, 'Task Orchestration');
  assert.equal(group.preserveChildrenWhenDisabled, true);
  assert.equal(group.children.enable_sub_agents.section, 'Delegation');
  assert.equal(group.children.enable_cron_scheduler.section, 'Scheduling');
  assert.equal(FEATURE_SCHEMA.task_manager, undefined);
  assert.equal(FEATURE_SCHEMA.enable_cron_scheduler, undefined);
});

test('preserves disabled child selections and rejects an invalid mode', () => {
  const disabled = parseFeatures({ task_orchestration: {
    enabled: false,
    mode: 'task_system',
    enable_sub_agents: true,
    enable_cron_scheduler: true,
  }}).task_orchestration;
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.mode, 'task_system');
  assert.equal(disabled.enable_sub_agents, true);
  assert.equal(disabled.enable_cron_scheduler, true);

  const invalid = parseFeatures({ task_orchestration: { enabled: true, mode: 'invalid' } });
  assert.equal(invalid.task_orchestration.mode, 'todo');
});
```

- [ ] **Step 3: Run both tests and verify RED**

Run: `node --test src/lib/taskOrchestration.test.js src/lib/FeatureSchema.test.js`

Expected: FAIL because `taskOrchestration.js` and the canonical schema do not exist.

- [ ] **Step 4: Implement the pure policy**

Define one ordered managed-tool list, remove every managed tool and duplicate atomic tool by `getToolName`, then append the selected planning, delegation, background, and Cron tools. `isOrchestrationEnabled(config, capability)` returns false when the parent is disabled and otherwise checks an optional boolean child.

- [ ] **Step 5: Replace the Feature Schema group**

Rename the group to `task_orchestration`, add `enable_sub_agents` and `enable_cron_scheduler`, add exact section labels (`Planning & Tracking`, `Delegation`, `Execution`, `Scheduling`, `System Guidelines`), remove the top-level Cron switch, and mark the group `preserveChildrenWhenDisabled: true`. Update `parseFeatures` so select values must match declared options and this marked group preserves child values while disabled.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test src/lib/taskOrchestration.test.js src/lib/FeatureSchema.test.js`

Expected: all policy and schema tests PASS.

```bash
git add src/lib/taskOrchestration.js src/lib/taskOrchestration.test.js src/lib/FeatureSchema.js src/lib/FeatureSchema.test.js
git commit -m "feat(orchestration): add canonical task policy"
```

### Task 2: Hard-Migrate Every Harness

**Files:**
- Modify: `harnesses/00-full-test.json`
- Modify: `harnesses/01-chat-bot.json`
- Modify: `harnesses/02-bash.json`
- Modify: `harnesses/03-deep-research.json`
- Modify: `harnesses/04-subagent.json`
- Modify: `harnesses/05-task-system.json`
- Modify: `harnesses/102-todos-without-reminder.json`
- Modify: `harnesses/test-security.json`
- Create: `server/agent/taskOrchestrationHarnesses.test.js`

**Interfaces:**
- Consumes: `ORCHESTRATION_MANAGED_TOOL_NAMES` and `parseFeatures` from Task 1.
- Produces: a repository containing only canonical Harness configuration.

- [ ] **Step 1: Write the failing repository migration test**

Read every JSON file in `harnesses/` and assert:

```js
assert.equal(harness.features?.task_manager, undefined, `${file}: legacy task_manager`);
assert.equal(harness.features?.enable_cron_scheduler, undefined, `${file}: legacy cron switch`);
assert.ok(harness.features?.task_orchestration, `${file}: missing task_orchestration`);
assert.deepEqual(
  harness.tools.filter(tool => ORCHESTRATION_MANAGED_TOOL_NAMES.includes(typeof tool === 'string' ? tool : tool.name)),
  [],
  `${file}: manually mounted orchestration tool`,
);
assert.equal(parseFeatures(harness.features).task_orchestration.enabled, harness.features.task_orchestration.enabled);
```

- [ ] **Step 2: Verify RED against current Harnesses**

Run: `node --test server/agent/taskOrchestrationHarnesses.test.js`

Expected: FAIL on legacy `task_manager`, top-level Cron, and `sub_agent` entries.

- [ ] **Step 3: Perform the mechanical JSON migration**

For each Harness, rename the group, preserve its mode/prompts/background setting, move the Cron value into the group, set `enable_sub_agents: true` only where `sub_agent` was previously mounted, default it to false elsewhere, and remove every managed tool from `tools`. Keep pretty two-space JSON formatting and do not modify unrelated Harness fields.

- [ ] **Step 4: Verify all Harnesses and commit**

Run: `node --test server/agent/taskOrchestrationHarnesses.test.js src/lib/taskOrchestration.test.js src/lib/FeatureSchema.test.js`

Expected: all migration, policy, and schema tests PASS.

```bash
git add harnesses server/agent/taskOrchestrationHarnesses.test.js
git commit -m "refactor(harness): migrate task orchestration config"
```

### Task 3: Apply the Policy Across Agent Execution

**Files:**
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server/agent/plugins/TodoNagPlugin.js`
- Modify: `server/agent/plugins/TaskSystemPlugin.js`
- Modify: `src/hooks/useAgentLoop.js`
- Modify: `src/components/TrajectoryView.jsx`
- Create: `server/agent/AgentExecutor.orchestration.test.js`

**Interfaces:**
- Consumes: `resolveOrchestrationTools` and `isOrchestrationEnabled` from Task 1.
- Produces: one effective tool list and canonical feature reads for all normal Agent runs.

- [ ] **Step 1: Write failing AgentExecutor policy tests**

Construct Executors with parent disabled, Todo, and Task System configurations. Assert exact managed tools, no duplicates, `get_current_time` remains mounted, and background/Cron tools require both parent and child switches.

```js
const executor = new AgentExecutor({
  tools: ['bash', 'sub_agent', 'write_todos'],
  features: { task_orchestration: { enabled: false, mode: 'todo', enable_sub_agents: true } },
});
assert.deepEqual(executor.tools.sort(), ['bash', 'get_current_time'].sort());
```

- [ ] **Step 2: Verify RED**

Run: `node --test server/agent/AgentExecutor.orchestration.test.js`

Expected: FAIL because AgentExecutor still reads `task_manager` and the top-level Cron switch.

- [ ] **Step 3: Replace constructor-level tool assembly**

Call `resolveOrchestrationTools(tools, this.features.task_orchestration)` once after parsing features, then append `get_current_time` once. Derive Todo and Task System plugin registration from the canonical parent and mode. Remove the old board-tool filtering and top-level Cron injection blocks.

- [ ] **Step 4: Replace remaining runtime and UI feature reads**

Update background execution, schema generation, Todo/Task prompt lookup, scheduled polling, and trajectory-tab visibility to use `task_orchestration`. Every child condition must include `task_orchestration.enabled`.

- [ ] **Step 5: Verify policy integration and commit**

Run: `node --test server/agent/AgentExecutor.orchestration.test.js server/agent/plugins/*.test.js src/lib/*.test.js`

Expected: all selected tests PASS.

Run: `rg -n "task_manager|features\.enable_cron_scheduler" server src --glob '!server/sessions/**'`

Expected: no output.

```bash
git add server/agent/AgentExecutor.js server/agent/AgentExecutor.orchestration.test.js server/agent/plugins/TodoNagPlugin.js server/agent/plugins/TaskSystemPlugin.js src/hooks/useAgentLoop.js src/components/TrajectoryView.jsx
git commit -m "refactor(orchestration): centralize runtime capability mounting"
```

### Task 4: Isolate and Correct One-Off Sub-agents

**Files:**
- Create: `server/agent/subAgentProfile.js`
- Create: `server/agent/subAgentProfile.test.js`
- Modify: `server/agent/plugins/SubAgentPlugin.js`
- Create: `server/agent/plugins/SubAgentPlugin.test.js`

**Interfaces:**
- Produces: `createSubAgentFeatures(parentFeatures): object`.
- Produces: `selectSubAgentTools(parentTools): Array<string|object>`.
- Produces: `getLastAssistantText(messages): string|null`.
- Produces: `runSubAgent({ parentExecutor, tool, ExecutorClass? }): Promise<void>` for dependency-injected tests.

- [ ] **Step 1: Write failing profile tests**

Assert that the profile deep-clones its input, disables `task_orchestration` and `enable_memory`, retains security/context/skills/error recovery, removes every managed orchestration tool represented as strings or objects, and returns only the final non-empty assistant text.

```js
const parent = { task_orchestration: { enabled: true }, enable_memory: { enabled: true }, security_mode: 'strict' };
const child = createSubAgentFeatures(parent);
assert.equal(child.task_orchestration.enabled, false);
assert.equal(child.enable_memory.enabled, false);
assert.equal(child.security_mode, 'strict');
assert.equal(parent.task_orchestration.enabled, true);
assert.deepEqual(selectSubAgentTools(['bash', 'sub_agent', { name: 'schedule_cron' }]), ['bash']);
```

- [ ] **Step 2: Write failing plugin lifecycle tests**

Use a fake Executor class that captures constructor parameters. Verify fresh messages, inherited model settings and skills, nested events with `parentToolCallId`, final-text-only output, empty-final fallback, `tool.handled = true`, and thrown child errors converted to a tool result.

- [ ] **Step 3: Verify RED**

Run: `node --test server/agent/subAgentProfile.test.js server/agent/plugins/SubAgentPlugin.test.js`

Expected: FAIL because the profile helpers and injectable runner do not exist.

- [ ] **Step 4: Implement the child profile and plugin runner**

Use `structuredClone` for features, explicitly disable orchestration and memory, filter by `ORCHESTRATION_MANAGED_TOOL_NAMES`, and select the last message where `role === 'assistant'`, `type === 'text'`, and trimmed content is non-empty. Pass `parentExecutor.skills` into the child. Keep the dedicated prompt explicit that delegation is forbidden.

- [ ] **Step 5: Verify Sub-agent behavior and commit**

Run: `node --test server/agent/subAgentProfile.test.js server/agent/plugins/SubAgentPlugin.test.js server/agent/AgentExecutor.orchestration.test.js`

Expected: all selected tests PASS.

```bash
git add server/agent/subAgentProfile.js server/agent/subAgentProfile.test.js server/agent/plugins/SubAgentPlugin.js server/agent/plugins/SubAgentPlugin.test.js
git commit -m "fix(agent): isolate one-off sub-agent execution"
```

### Task 5: Pause Disabled Cron Execution Without Losing Jobs

**Files:**
- Modify: `server/agent/scheduler/cronScheduler.js`
- Modify: `server/agent/scheduler/cronScheduler.test.js`
- Modify: `server/agent/scheduler/cronRunner.js`
- Modify: `server/agent/scheduler/cronRunner.test.js`

**Interfaces:**
- Produces: `cronScheduler.markEventSkipped(event): Promise<object|null>`.
- Produces: `isScheduledExecutionEnabled(harness): boolean`.
- Extends: `processScheduledEvents({ shouldRunEvent })` with an async eligibility callback.

- [ ] **Step 1: Write failing scheduler-state tests**

Add tests proving `markEventSkipped` restores a recurring and one-shot job to `idle`, changes no counters, creates no run history, and keeps a one-shot job registered. Add a test proving one-shot removal occurs in `markEventStarted`, not `tick`.

- [ ] **Step 2: Write failing runner eligibility tests**

Inject `shouldRunEvent` into `processScheduledEvents`. Assert false eligibility calls `markEventSkipped`, does not reserve the Harness, does not call `markEventStarted` or `runEvent`, and leaves run history empty. Test parent-disabled and Cron-child-disabled Harnesses through `isScheduledExecutionEnabled`.

- [ ] **Step 3: Verify RED**

Run: `node --test server/agent/scheduler/cronScheduler.test.js server/agent/scheduler/cronRunner.test.js`

Expected: FAIL because skip state and eligibility checks do not exist.

- [ ] **Step 4: Implement scheduler skip state and one-shot timing**

Keep one-shot jobs in the map during `tick`. `markEventStarted` removes a non-recurring job after recording the running history. `markEventSkipped` sets an existing job to `idle`, clears queued state through normal draining, persists durable state, and does not create a run.

- [ ] **Step 5: Implement the pre-run feature gate**

Use `parseFeatures(harness.features).task_orchestration` in `isScheduledExecutionEnabled`. The default queue processor loads the Harness before starting an event; explicit false skips it. A Harness-load or parse exception must proceed into the existing execution path so it becomes a real failed run rather than a silent skip.

- [ ] **Step 6: Verify Cron behavior and commit**

Run: `node --test server/agent/scheduler/*.test.js`

Expected: every scheduler, runner, store, API, and expression test PASS.

```bash
git add server/agent/scheduler/cronScheduler.js server/agent/scheduler/cronScheduler.test.js server/agent/scheduler/cronRunner.js server/agent/scheduler/cronRunner.test.js
git commit -m "feat(scheduler): pause disabled orchestration jobs"
```

### Task 6: Reorganize the Task Orchestration UI

**Files:**
- Modify: `src/pages/PromptLabPage.jsx`
- Modify: `src/lib/taskOrchestration.js`
- Modify: `src/lib/taskOrchestration.test.js`
- Modify: `src/components/TrajectoryView.jsx` if final visibility extraction is needed

**Interfaces:**
- Consumes: `ORCHESTRATION_MANAGED_TOOL_NAMES` for Tools Mounting filtering.
- Consumes: schema child `section` values for visual grouping.
- Produces: `getTaskOrchestrationVisibility(features)` if visibility logic needs extraction from React for testing.

- [ ] **Step 1: Add failing UI-policy tests**

Test that the managed-tool list contains Sub-agent, background, task, and Cron tools but excludes atomic tools and `get_current_time`. If trajectory visibility is extracted, test parent-off hides all tabs and each child controls only its corresponding tab.

- [ ] **Step 2: Verify RED for any newly extracted helper**

Run: `node --test src/lib/taskOrchestration.test.js`

Expected: FAIL on the newly specified visibility behavior before implementation.

- [ ] **Step 3: Hide orchestration tools and render section headings**

Replace `SYSTEM_HIDDEN_TOOLS` with the shared managed-tool list. While rendering group children, insert a compact section heading whenever `subMeta.section` changes. Keep the existing parent-disabled opacity and pointer blocking, preserve values, and retain mode-specific prompt editors.

- [ ] **Step 4: Verify frontend behavior**

Run: `node --test src/lib/*.test.js`

Expected: all frontend library tests PASS.

Run: `npm run build`

Expected: Vite production build exits 0.

- [ ] **Step 5: Run the app and inspect desktop states**

Run: `npm run dev`

Open the Prompt Lab in the in-app browser and capture screenshots at a desktop viewport for:

- Task Orchestration enabled and expanded in Todo mode.
- Task Orchestration enabled and expanded in Task System mode.
- Task Orchestration disabled with retained but locked children.
- Tools Mounting with no orchestration-managed tools visible.

Confirm labels fit, section headings are distinct without nested cards, controls do not overlap, and Context Inspector still shows resolved auto-mounted tools.

- [ ] **Step 6: Commit the UI reorganization**

```bash
git add src/pages/PromptLabPage.jsx src/lib/taskOrchestration.js src/lib/taskOrchestration.test.js src/components/TrajectoryView.jsx
git commit -m "feat(ui): organize task orchestration settings"
```

### Task 7: Complete Regression Verification

**Files:**
- Modify only files required by failures directly caused by Tasks 1-6.

**Interfaces:**
- Consumes: every deliverable in Tasks 1-6.
- Produces: a clean feature branch ready for review and integration.

- [ ] **Step 1: Run all automated tests**

Run: `node --test server/**/*.test.js src/lib/*.test.js`

Expected: 0 failed tests.

- [ ] **Step 2: Verify migration completeness and formatting**

Run: `rg -n "task_manager|features\.enable_cron_scheduler" server src harnesses --glob '!server/sessions/**' --glob '!server/agent/taskOrchestrationHarnesses.test.js'`

Expected: no legacy configuration references.

Run: `rg -n '\"name\": \"(sub_agent|schedule_cron|list_crons|cancel_cron|write_todos|create_task|list_tasks|get_task|claim_task|complete_task|query_background_tasks)\"' harnesses`

Expected: no manually mounted orchestration-tool definitions.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 3: Run focused lint and production build**

Run ESLint on every changed JavaScript/JSX file rather than the known-failing whole repository lint command.

Run: `npm run build`

Expected: build exits 0.

- [ ] **Step 4: Inspect final Git state**

Run: `git status --short --branch`

Expected: branch `codex/task-orchestration` with a clean worktree.
