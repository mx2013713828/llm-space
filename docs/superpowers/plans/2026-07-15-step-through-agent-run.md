# Step-Through Agent Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add an optional Step Through runtime mode that pauses a foreground Agent Loop at model/tool semantic boundaries and advances only after the user presses Next step.

**Architecture:** A pure in-memory RunController owns checkpoint state and a deferred command gate. AgentExecutor calls it only after a completed model response that proposes tools and after a completed tool batch; it never pauses a provider stream. The active-job record owns the controller and exposes compact state through SSE and an advance endpoint. React renders one tail checkpoint card and sends commands independently from the stream.

**Tech Stack:** Node.js ESM, Express, SSE, React 19, Lucide React, node:test, Vite.

## Global Constraints

- continuous is the default and must remain behaviorally unchanged.
- step_through is per-run runtime metadata; do not persist it in Harness JSON or inject it into model-visible prompts.
- Pause only after a provider response or tool batch has completed; never abort a stream to create a checkpoint.
- The stable primary UI action is exactly Next step.
- Checkpoint text names the upcoming tool or MCP tool; multiple tools use bounded chips.
- Security approvals are higher priority than step controls and cannot be bypassed.
- Parent-level sub-agent and teammate calls are gated; children themselves run continuously.
- Scheduler and background runs do not use a controller.
- All event payloads are bounded and contain no raw large tool output.

---

### Task 1: Runtime Run Controller

**Files:**
- Create: server/agent/runtime/runController.js
- Create: server/agent/runtime/runController.test.js

**Interfaces:**
- Produces createRunController({ mode = 'continuous', onStateChange } = {}).
- Methods: getState(), waitForCheckpoint(checkpoint), advance({ action }), abort(), markInterrupted().
- Checkpoint: { phase: 'awaiting_tool_step' | 'awaiting_model_step', turn, nextAction, tools }.
- nextAction: { kind: 'tools' | 'model', description: string }.

- [ ] **Step 1: Write failing controller tests**

~~~js
test('step-through waits for next and emits a bounded tool checkpoint', async () => {
  const controller = createRunController({ mode: 'step_through' });
  const waiting = controller.waitForCheckpoint({
    phase: 'awaiting_tool_step',
    turn: 3,
    nextAction: { kind: 'tools', description: 'Next: run 2 tools' },
    tools: [{ name: 'read_file' }, { name: 'mcp__context7__query_docs' }],
  });

  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.advance({ action: 'next' }), true);
  assert.deepEqual(await waiting, { action: 'next' });
});

test('continuous controller never waits', async () => {
  const controller = createRunController({ mode: 'continuous' });
  assert.equal(await controller.waitForCheckpoint({ phase: 'awaiting_model_step' }), null);
});

test('run-to-completion resolves this checkpoint and disables later waits', async () => {
  const controller = createRunController({ mode: 'step_through' });
  const first = controller.waitForCheckpoint({ phase: 'awaiting_model_step' });
  controller.advance({ action: 'run_to_completion' });
  assert.deepEqual(await first, { action: 'run_to_completion' });
  assert.equal(await controller.waitForCheckpoint({ phase: 'awaiting_tool_step' }), null);
});
~~~

- [ ] **Step 2: Run test to verify failure**

Run: node --test server/agent/runtime/runController.test.js

Expected: module-not-found error for runController.js.

- [ ] **Step 3: Implement minimal controller**

~~~js
export function createRunController({ mode = 'continuous', onStateChange = () => {} } = {}) {
  let runMode = mode === 'step_through' ? 'step_through' : 'continuous';
  let state = { mode: runMode, status: 'running', checkpoint: null };
  let resolveWait = null;

  const publish = () => onStateChange({ ...state, checkpoint: state.checkpoint && { ...state.checkpoint } });
  return {
    getState: () => ({ ...state, checkpoint: state.checkpoint && { ...state.checkpoint } }),
    async waitForCheckpoint(checkpoint) {
      if (runMode === 'continuous') return null;
      state = { mode: runMode, status: 'paused', checkpoint };
      publish();
      return new Promise(resolve => { resolveWait = resolve; });
    },
    advance({ action }) {
      if (!resolveWait || !['next', 'run_to_completion'].includes(action)) return false;
      if (action === 'run_to_completion') runMode = 'continuous';
      const resolve = resolveWait;
      resolveWait = null;
      state = { mode: runMode, status: 'running', checkpoint: null };
      publish();
      resolve({ action });
      return true;
    },
  };
}
~~~

Add idempotent abort() and markInterrupted(). abort resolves an active wait with { action: 'abort' }. markInterrupted clears its waiter and publishes interrupted without normal progress.

- [ ] **Step 4: Run focused tests**

Run: node --test server/agent/runtime/runController.test.js

Expected: all controller state-machine tests pass.

- [ ] **Step 5: Commit**

~~~bash
git add server/agent/runtime/runController.js server/agent/runtime/runController.test.js
git commit -m "feat: add step-through run controller"
~~~

### Task 2: Checkpoint The Agent Executor

**Files:**
- Modify: server/agent/AgentExecutor.js
- Create: server/agent/runtime/stepThroughExecutor.test.js
- Modify: server/agent/runtime/reliabilityScenarios.test.js

**Interfaces:**
- AgentExecutor accepts optional runController.
- It calls runController.waitForCheckpoint(checkpoint) before an executable tool batch and after that batch settles.
- It emits no checkpoint for a final text response.

- [ ] **Step 1: Write failing executor tests**

~~~js
test('step-through pauses before a tool batch and after its result', async () => {
  const controller = createRunController({ mode: 'step_through' });
  const executor = createExecutorThatReturnsToolThenFinalText({ runController: controller });
  const running = executor.run();

  await waitFor(() => controller.getState().checkpoint?.phase === 'awaiting_tool_step');
  assert.match(controller.getState().checkpoint.nextAction.description, /read_file/);
  controller.advance({ action: 'next' });

  await waitFor(() => controller.getState().checkpoint?.phase === 'awaiting_model_step');
  controller.advance({ action: 'next' });
  await running;
  assert.equal(getLastAssistantText(executor.messages), 'final answer');
});

test('final model text does not create a step checkpoint', async () => {
  const controller = createRunController({ mode: 'step_through' });
  await createExecutorThatReturnsFinalText({ runController: controller }).run();
  assert.equal(controller.getState().checkpoint, null);
});
~~~

- [ ] **Step 2: Run test to verify failure**

Run: node --test server/agent/runtime/stepThroughExecutor.test.js

Expected: no checkpoint is emitted.

- [ ] **Step 3: Add executor checkpoints**

Add buildToolCheckpoint({ turn, tools }) mapping at most six calls to { id, name: tool.toolName }. Its description is Next: run <tool> for one call and Next: run <count> tools otherwise. Immediately before runToolStage, wait for awaiting_tool_step. After the tool stage and session save, wait for:

~~~js
{
  phase: 'awaiting_model_step',
  turn,
  nextAction: { kind: 'model', description: 'Next: ask the model for its next decision' },
  tools: [],
}
~~~

If wait returns { action: 'abort' }, stop through the existing cleanup path. Do not pause after permanent security blocks, final text, scheduler runs, or background child execution.

- [ ] **Step 4: Add approval and child-tool regression tests**

Prove preToolUse approval still occurs only after the tool checkpoint advances. Prove a sub_agent call is summarized as { name: 'sub_agent' } but its child loop receives no controller.

- [ ] **Step 5: Run focused tests and commit**

Run: node --test server/agent/runtime/stepThroughExecutor.test.js server/agent/runtime/reliabilityScenarios.test.js

Expected: all tests pass.

~~~bash
git add server/agent/AgentExecutor.js server/agent/runtime/stepThroughExecutor.test.js server/agent/runtime/reliabilityScenarios.test.js
git commit -m "feat: pause agent runs at semantic checkpoints"
~~~

### Task 3: Active Run Control API And SSE State

**Files:**
- Modify: server/agent/activeJobs.js
- Modify: server/routes/agentRunRoutes.js
- Modify: server/routes/agentRunRoutes.test.js
- Modify: server/agent/runtimeRequest.js

**Interfaces:**
- Runtime request normalizes body.runMode to continuous or step_through.
- Foreground jobs store { runId, executor, runController, clients, source }.
- POST /api/agent/runs/:runId/advance accepts next, run_to_completion, or abort.
- GET /api/agent/status/:harnessId returns optional runControl.

- [ ] **Step 1: Write failing route tests**

~~~js
test('advance route resolves the matching paused active run only', async () => {
  const controller = createRunController({ mode: 'step_through' });
  reservePausedJob(activeJobs, { harnessId: 'h1', runId: 'run_1', controller });
  const response = await post(app, '/api/agent/runs/run_1/advance', { action: 'next' });
  assert.equal(response.statusCode, 200);
  assert.equal(controller.getState().status, 'running');
});

test('active run attachment sends compact control state after messages', async () => {
  const events = attachToActiveJobAndReadEvents(activeJobs, 'h1');
  assert.equal(events.at(-1).type, 'run_control_state');
  assert.equal(events.at(-1).status, 'paused');
});
~~~

- [ ] **Step 2: Run test to verify failure**

Run: node --test server/routes/agentRunRoutes.test.js

Expected: missing advance route and no control-state event.

- [ ] **Step 3: Normalize and wire controller**

In buildRuntimeRequest add:

~~~js
runMode: body.runMode === 'step_through' ? 'step_through' : 'continuous',
~~~

Generate runId with crypto.randomUUID() for foreground jobs. Create a controller whose state callback broadcasts run_control_state with runId and compact state. Pass it to AgentExecutor. The advance route finds only a currently active job with matching runId, validates action, calls controller.advance({ action }), and returns { accepted, runControl }.

- [ ] **Step 4: Reattach and keepalive**

attachToActiveJob sends messages, todos, background tasks, then run_control_state when present. Add a 15-second SSE comment keepalive only while a foreground controller is paused; clear it on connection close. Keepalive never enters persisted messages.

- [ ] **Step 5: Run route tests and commit**

Run: node --test server/routes/agentRunRoutes.test.js server/agent/activeJobs.test.js

Expected: route, attach, and registry tests pass.

~~~bash
git add server/agent/activeJobs.js server/agent/runtimeRequest.js server/routes/agentRunRoutes.js server/routes/agentRunRoutes.test.js
git commit -m "feat: expose step-through run controls"
~~~

### Task 4: Frontend Mode And Checkpoint Card

**Files:**
- Create: src/lib/runControlPresentation.js
- Create: src/lib/runControlPresentation.test.js
- Modify: src/hooks/useAgentLoop.js
- Modify: src/components/TrajectoryView.jsx
- Modify: src/App.css

**Interfaces:**
- getRunControlPresentation(runControl) returns { visible, phaseLabel, nextDescription, tools, primaryLabel }.
- useAgentLoop exposes runMode, setRunMode, runControl, and advanceRun(action).
- TrajectoryView receives those props and renders one tail-only checkpoint card.

- [ ] **Step 1: Write failing presentation test**

~~~js
test('presents one stable next-step action and tool chips', () => {
  assert.deepEqual(getRunControlPresentation({
    status: 'paused',
    checkpoint: {
      phase: 'awaiting_tool_step',
      nextAction: { description: 'Next: run 2 tools' },
      tools: [{ name: 'read_file' }, { name: 'mcp__context7__query_docs' }],
    },
  }), {
    visible: true,
    phaseLabel: 'Awaiting next step',
    nextDescription: 'Next: run 2 tools',
    tools: ['read_file', 'mcp__context7__query_docs'],
    primaryLabel: 'Next step',
  });
});
~~~

- [ ] **Step 2: Run test to verify failure**

Run: node --test src/lib/runControlPresentation.test.js

Expected: module-not-found error.

- [ ] **Step 3: Implement presentation and hook state**

The helper hides malformed state, clamps chips to six names, and always uses Next step. In useAgentLoop use browser key llm-space.run-mode.<harnessId>.v1; send runMode with /api/agent/run; process run_control_state by flushing event batches then setting state; reset on done, abort, Harness switch, and new run.

~~~js
const advanceRun = async (action = 'next') => {
  if (!runControl?.runId) return;
  const response = await apiFetch('/api/agent/runs/' + encodeURIComponent(runControl.runId) + '/advance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  if (!response.ok) throw new Error('The paused run is no longer available.');
};
~~~

- [ ] **Step 4: Render controls**

Place a compact Continuous / Step Through selector beside Run Trajectory. Render a single checkpoint card only at the trajectory tail while paused. It shows Awaiting next step, server-provided Next: text, optional tool chips, primary Next step, and secondary Run to completion. Use Lucide StepForward, Play, and FastForward with tooltips. The existing stop action remains abort.

- [ ] **Step 5: Add CSS and verify**

Use stable card dimensions, flex-wrapping chips, and full-width actions at narrow widths. Do not nest the card inside a message card.

Run: node --test src/lib/runControlPresentation.test.js src/hooks/useAgentLoop.test.js && npm run build

Expected: tests pass and Vite completes.

- [ ] **Step 6: Commit**

~~~bash
git add src/lib/runControlPresentation.js src/lib/runControlPresentation.test.js src/hooks/useAgentLoop.js src/components/TrajectoryView.jsx src/App.css
git commit -m "feat: add step-through trajectory controls"
~~~

### Task 5: End-To-End Reliability And Documentation

**Files:**
- Modify: server/agent/runtime/reliabilityScenarios.test.js
- Modify: server/routes/agentRunRoutes.test.js
- Modify: README.md
- Modify: the repository's Chinese README path
- Modify: docs/DEVELOPMENT_SPEC.md
- Modify: docs/DEVELOPMENT_SPEC.en.md

**Interfaces:**
- Documents Step Through as a foreground runtime control distinct from execution strategies.
- Tests cover tool, MCP, approval, refresh/attach, abort, and run-to-completion paths.

- [ ] **Step 1: Write end-to-end tests**

~~~js
test('paused step-through run can reattach and then run to completion', async () => {
  const { runId, controller, attachedEvents } = await startPausedToolRun();
  assert.equal(attachedEvents.some(event => event.type === 'run_control_state'), true);
  await post(app, '/api/agent/runs/' + runId + '/advance', { action: 'run_to_completion' });
  assert.equal(controller.getState().mode, 'continuous');
  await waitForRunDone();
});

test('approval is not resolved by next step', async () => {
  const controller = await startPausedProtectedToolRun();
  controller.advance({ action: 'next' });
  await waitForPermissionRequest();
  assert.equal(permissionWasResolved(), false);
});
~~~

- [ ] **Step 2: Run focused integration tests**

Run: node --test server/agent/runtime/reliabilityScenarios.test.js server/routes/agentRunRoutes.test.js

Expected: new behavior tests pass after Tasks 1-4. Fix only observable integration gaps.

- [ ] **Step 3: Update documentation**

Document foreground-only behavior, both checkpoint types, Next step, Run to completion, continuous children, approval precedence, and server-restart interruption. Keep README concise and point to the development specification for details.

- [ ] **Step 4: Run final verification**

Run: npm test && npm run build && git diff --check

Expected: full suite passes, Vite completes successfully, and there are no whitespace errors.

- [ ] **Step 5: Manual acceptance**

1. Run a one-tool foreground prompt in Step Through; verify output pauses before the named tool.
2. Press Next step; verify tool output appears and a model-decision checkpoint follows.
3. Press Next step; verify final answer completes with no redundant checkpoint.
4. Repeat with a mounted MCP tool; verify its namespaced name appears.
5. Repeat with sub_agent; verify parent gates launch while child progress remains continuous.
6. Run a protected tool; verify Next step leads to normal approval, not execution.
7. Refresh while paused; verify active run reattaches and remains actionable.
8. Use Run to completion; verify later boundaries do not pause.
9. Use Continuous mode; verify no checkpoint card appears.

- [ ] **Step 6: Commit**

~~~bash
git add README.md README.zh-CN.md docs/DEVELOPMENT_SPEC.md docs/DEVELOPMENT_SPEC.en.md server/agent/runtime/reliabilityScenarios.test.js server/routes/agentRunRoutes.test.js
git commit -m "docs: document step-through agent runs"
~~~

