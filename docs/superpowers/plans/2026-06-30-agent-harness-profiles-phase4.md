# Agent Harness Profiles Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the team runtime so async teammates behave as adapters over the shared child runtime state and outcome model.

**Architecture:** TeamBus remains the protocol layer for team inbox messages. Team state semantics move into a small shared helper so `TeamPlugin`, `wait_for_teammates`, and teammate status formatting use one state model. The teammate outcome adapter keeps a thin compatibility wrapper over `buildChildOutcome`, but no longer carries `maxTurns` as teammate runtime semantics.

**Tech Stack:** Node.js ESM, `node:test`, existing TeamPlugin / teammate runner modules.

## Global Constraints

- Keep TeamBus as a teammate/team protocol layer, not part of core child runtime.
- Do not expose or implement fake cancellation in this phase.
- Do not remove `spawn_teammate.maxTurns` from the tool schema yet; Phase 5 handles public schema removal/deprecation cleanup.
- Use TDD: write failing tests before production code.
- Commit each phase task separately.

---

## File Structure

- Create `server/agent/teams/teamRuntimeState.js`
  - Owns teammate state constants, terminal-state detection, unresolved teammate selection, and compact status-line formatting.
- Create `server/agent/teams/teamRuntimeState.test.js`
  - Verifies `running`, `awaiting_permission`, `completed`, `failed`, `cancelled`, and `no_result` semantics.
- Modify `server/agent/plugins/TeamPlugin.js`
  - Replaces local terminal/unresolved state logic with the shared helper.
  - Uses the helper to include permission wait actions in team status output.
- Modify `server/agent/plugins/TeamPlugin.test.js`
  - Verifies `awaiting_permission` remains unresolved and includes the current action in wait output.
- Modify `server/agent/teams/teammateOutcome.js`
  - Removes `maxTurns` from the teammate wrapper around `buildChildOutcome`.
- Modify `server/agent/teams/teammateOutcome.test.js`
  - Verifies legacy `turn_limit` maps to `no_result` without teammate max-turn hints.
- Modify `server/agent/teams/teammateRunner.js`
  - Removes `maxTurns` from the runner interface and from outcome construction.
- Modify `server/agent/teams/teammateRunner.test.js`
  - Verifies legacy `turn_limit` still maps to `no_result`, but no longer includes a teammate max-turn hint.
- Modify `docs/superpowers/specs/2026-06-29-agent-harness-profiles-design.md`
  - Marks Phase 4 completed after verification.
- Modify this plan file
  - Records completed tasks and commits.

---

### Task 1: Shared Team Runtime State Helper

**Files:**
- Create: `server/agent/teams/teamRuntimeState.js`
- Create: `server/agent/teams/teamRuntimeState.test.js`
- Modify: `server/agent/plugins/TeamPlugin.js`
- Modify: `server/agent/plugins/TeamPlugin.test.js`

**Interfaces:**
- Produces: `TERMINAL_TEAMMATE_STATES: Set<string>`
- Produces: `isTerminalTeammateState(state: string): boolean`
- Produces: `getUnresolvedTeammates(state: object): object[]`
- Produces: `formatTeammateStatusLine(teammate: object): string`
- Consumes: existing persisted team state shape `{ teammates: Record<string, teammate> }`

- [ ] **Step 1: Write failing helper tests**

Add tests proving:

```js
assert.equal(isTerminalTeammateState('completed'), true);
assert.equal(isTerminalTeammateState('failed'), true);
assert.equal(isTerminalTeammateState('cancelled'), true);
assert.equal(isTerminalTeammateState('no_result'), true);
assert.equal(isTerminalTeammateState('running'), false);
assert.equal(isTerminalTeammateState('awaiting_permission'), false);
assert.deepEqual(
  getUnresolvedTeammates({
    teammates: {
      a: { agentId: 'a', state: 'completed' },
      b: { agentId: 'b', state: 'awaiting_permission' },
      c: { agentId: 'c', state: 'running' },
    },
  }).map(teammate => teammate.agentId),
  ['b', 'c'],
);
assert.equal(
  formatTeammateStatusLine({
    name: 'tests',
    state: 'awaiting_permission',
    currentAction: 'waiting for permission: write_file',
  }),
  '- tests: awaiting_permission (waiting for permission: write_file)',
);
```

- [ ] **Step 2: Verify red**

Run: `node --test server/agent/teams/teamRuntimeState.test.js`

Expected: FAIL with module-not-found or missing export errors.

- [ ] **Step 3: Implement helper and wire TeamPlugin**

Implement the helper with these state semantics:

```js
export const TERMINAL_TEAMMATE_STATES = new Set(['completed', 'failed', 'no_result', 'cancelled']);

export function isTerminalTeammateState(state) {
  return TERMINAL_TEAMMATE_STATES.has(state);
}

export function getUnresolvedTeammates(state) {
  return Object.values(state?.teammates ?? {}).filter(teammate => !isTerminalTeammateState(teammate.state));
}

export function formatTeammateStatusLine(teammate) {
  const name = teammate.name || teammate.agentId;
  const detail = teammate.error || teammate.currentAction || '';
  return `- ${name}: ${teammate.state}${detail ? ` (${detail})` : ''}`;
}
```

Update `TeamPlugin.js` to import these helpers and remove its local terminal-state constant and duplicated unresolved filtering.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test server/agent/teams/teamRuntimeState.test.js server/agent/plugins/TeamPlugin.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/teams/teamRuntimeState.js server/agent/teams/teamRuntimeState.test.js server/agent/plugins/TeamPlugin.js server/agent/plugins/TeamPlugin.test.js
git commit -m "refactor: centralize team runtime states"
```

---

### Task 2: Remove Teammate Max-Turn Outcome Semantics

**Files:**
- Modify: `server/agent/teams/teammateOutcome.js`
- Modify: `server/agent/teams/teammateOutcome.test.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `server/agent/teams/teammateRunner.test.js`

**Interfaces:**
- Produces: `buildTeammateOutcome({ messages, stopReason }): ChildOutcome`
- Consumes: `buildChildOutcome({ messages, stopReason, childLabel })`

- [ ] **Step 1: Write failing tests**

Update teammate outcome and runner tests so legacy `turn_limit` still becomes `no_result`, but error text does not include a teammate max-turn count:

```js
const outcome = buildTeammateOutcome({
  messages: [{ role: 'assistant', type: 'text', content: 'Partial.' }],
  stopReason: 'turn_limit',
});

assert.equal(outcome.status, 'no_result');
assert.match(outcome.error, /legacy turn limit/i);
assert.doesNotMatch(outcome.error, /\(4\)|\(6\)|\(8\)/);
```

In `teammateRunner.test.js`, call `runTeammate` without `maxTurns` and assert the final error does not contain a count:

```js
assert.match(updates[1].updates.error, /legacy turn limit/i);
assert.doesNotMatch(updates[1].updates.error, /\(\d+\)/);
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.test.js
```

Expected: FAIL because current teammate outcome still injects a legacy max-turn hint.

- [ ] **Step 3: Implement minimal cleanup**

Change `buildTeammateOutcome` to:

```js
export function buildTeammateOutcome({ messages = [], stopReason = '' } = {}) {
  return buildChildOutcome({
    messages,
    stopReason,
    childLabel: 'Teammate',
  });
}
```

Remove `maxTurns` from `runTeammate` destructuring and from the `buildTeammateOutcome` call.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.test.js server/agent/plugins/TeamPlugin.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/agent/teams/teammateOutcome.js server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.js server/agent/teams/teammateRunner.test.js
git commit -m "refactor: remove teammate max turn semantics"
```

---

### Task 3: Phase 4 Documentation and Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-29-agent-harness-profiles-design.md`
- Modify: `docs/superpowers/plans/2026-06-30-agent-harness-profiles-phase4.md`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 commits.
- Produces: documented Phase 4 completion status.

- [ ] **Step 1: Update docs**

Mark Phase 4 work items as completed:

```markdown
1. Done: Keep TeamBus as protocol layer.
2. Done: Make teammate adapter consume child runtime outcomes.
3. Done: Simplify `wait_for_teammates` around `running`, `awaiting_permission`, `completed`, `failed`, `cancelled`, `no_result`.
4. Done: Remove `turn_limit` from team state creation.
```

Record the Task 1 and Task 2 commit hashes in this plan.

- [ ] **Step 2: Run full verification**

Run:

```bash
node --test $(rg --files -g '*test.js' | sort)
npm run build
```

Expected: all tests pass and build succeeds.

- [ ] **Step 3: Commit docs**

```bash
git add -f docs/superpowers/specs/2026-06-29-agent-harness-profiles-design.md docs/superpowers/plans/2026-06-30-agent-harness-profiles-phase4.md
git commit -m "docs: mark team runtime phase complete"
```

## Self-Review

- Spec coverage: This plan covers all Phase 4 bullets and intentionally leaves public schema removal and cancellation for later phases.
- Placeholder scan: No placeholder text remains.
- Type consistency: State helper names match the files and imports planned above.
