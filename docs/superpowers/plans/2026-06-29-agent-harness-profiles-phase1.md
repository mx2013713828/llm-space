# Agent Harness Profiles Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the first shared child-agent runtime foundations for sub-agents and teammates while removing new `turn_limit` production from child paths.

**Architecture:** Add shared child runtime modules for outcome interpretation and event bridging. Keep `SubAgentPlugin` and `TeamPlugin` as adapters, but make them consume shared child logic. Child runs become unbounded by passing `Infinity` to the existing executor loop until a later phase replaces the `run(maxTurns)` API.

**Tech Stack:** Node.js ESM, `node:test`, React/Vite frontend, existing `AgentExecutor` and plugin architecture.

**Completed:** 2026-06-29

**Phase 1 Commits:**
- `247174f feat: add shared child outcome`
- `80bbe31 feat: share child event bridge`
- `498d698 feat: make child agent runs unbounded`
- `a6088cb feat: preserve child permission source`

**Verification:**
- `node --test $(rg --files -g '*test.js' | sort)` — PASS, 255 tests
- `npm run build` — PASS

## Global Constraints

- `sub_agent` and teammates are harness profiles over the same executor runtime.
- New child runs must not create `turn_limit` as a normal product state.
- Permission requests from child agents must remain visible and approvable, not suppressed.
- TeamBus remains an adapter/protocol concern, not a core child runtime dependency.
- Keep first-phase edits focused on shared foundation modules and adapter rewiring.

---

### Task 1: Shared Child Outcome

**Files:**
- Create: `server/agent/child/childOutcome.js`
- Create: `server/agent/child/childOutcome.test.js`
- Modify: `server/agent/teams/teammateOutcome.js`
- Modify: `server/agent/teams/teammateOutcome.test.js`
- Modify: `server/agent/subAgentProfile.js`
- Modify: `server/agent/plugins/SubAgentPlugin.test.js`

**Interfaces:**
- Produces: `buildChildOutcome({ messages, stopReason, requireFinalText, legacyMaxTurns })`
- Produces statuses: `completed | failed | cancelled | no_result`
- Legacy: `stopReason === 'turn_limit'` maps to `no_result` for new shared outcome.

- [x] **Step 1: Write failing child outcome tests**

Add tests that expect:

```js
buildChildOutcome({
  messages: [
    { role: 'assistant', type: 'text', content: 'I will inspect files.' },
    { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
  ],
  stopReason: 'end_turn',
}).status === 'no_result';
```

And:

```js
buildChildOutcome({
  messages: [{ role: 'assistant', type: 'text', content: 'Partial.' }],
  stopReason: 'turn_limit',
}).status === 'no_result';
```

- [x] **Step 2: Run red test**

Run: `node --test server/agent/child/childOutcome.test.js`

Expected: FAIL because `server/agent/child/childOutcome.js` does not exist.

- [x] **Step 3: Implement child outcome**

Create `buildChildOutcome` by generalizing teammate outcome behavior, but do not emit `turn_limit`.

- [x] **Step 4: Rewire teammate outcome wrapper**

Make `server/agent/teams/teammateOutcome.js` call `buildChildOutcome` and preserve the old exported `buildTeammateOutcome` function name for adapter compatibility.

- [x] **Step 5: Rewire sub-agent final handling**

Use `buildChildOutcome` in `runSubAgent`. If `no_result`, set `tool.toolOutput` to the existing empty result string and emit trace/status with `status: 'no_result'`.

- [x] **Step 6: Run targeted tests**

Run:

```bash
node --test server/agent/child/childOutcome.test.js server/agent/teams/teammateOutcome.test.js server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/agent/child/childOutcome.js server/agent/child/childOutcome.test.js server/agent/teams/teammateOutcome.js server/agent/teams/teammateOutcome.test.js server/agent/subAgentProfile.js server/agent/plugins/SubAgentPlugin.test.js
git commit -m "feat: add shared child outcome"
```

### Task 2: Shared Child Event Bridge

**Files:**
- Create: `server/agent/child/childEventBridge.js`
- Create: `server/agent/child/childEventBridge.test.js`
- Modify: `server/agent/subAgentProfile.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `server/agent/teams/teammateRunner.test.js`

**Interfaces:**
- Produces: `createChildEventBridge({ parentExecutor, childType, childId, name, role, parentToolCallId, teamId, startedAt, onStatus })`
- Emits parent events for `permission_request` and `permission_resolved` with `runtimeRole`, `childType`, `childId`, `name`, `role`, `parentToolCallId`, and `teamId`.
- For sub-agent, maps child tool/thinking/text events into existing `sub_agent_status`.
- For teammate, preserves existing `team_update` forwarding and permission bridging.

- [x] **Step 1: Write failing event bridge tests**

Test that a child `permission_request` sets `parentExecutor.pendingPermission` and forwards a parent event with child metadata.

- [x] **Step 2: Run red test**

Run: `node --test server/agent/child/childEventBridge.test.js`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement event bridge**

Move shared permission forwarding and lightweight status helpers into `childEventBridge.js`.

- [x] **Step 4: Rewire sub-agent**

Use `createChildEventBridge` in `runSubAgent`, preserving current sub-agent status UI events and adding permission forwarding.

- [x] **Step 5: Rewire teammate**

Use `createChildEventBridge` in `runTeammate` for permission events while keeping TeamBus/team status adapter behavior.

- [x] **Step 6: Run targeted tests**

Run:

```bash
node --test server/agent/child/childEventBridge.test.js server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js server/agent/plugins/SecurityPlugin.test.js
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add server/agent/child/childEventBridge.js server/agent/child/childEventBridge.test.js server/agent/subAgentProfile.js server/agent/teams/teammateRunner.js server/agent/teams/teammateRunner.test.js
git commit -m "feat: share child event bridge"
```

### Task 3: Unbounded Child Runs

**Files:**
- Modify: `server/agent/subAgentProfile.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `server/agent/plugins/TeamPlugin.js`
- Modify: `server/agent/plugins/TeamPlugin.test.js`
- Modify: `server/agent/teams/teammateRunner.test.js`
- Modify: `server/agent/AgentExecutor.stream.test.js`

**Interfaces:**
- Child adapters call `childExecutor.run(Number.POSITIVE_INFINITY)`.
- `spawn_teammate.maxTurns` is accepted for legacy input but ignored for new child execution.
- Existing finite `AgentExecutor.run(maxTurns)` behavior remains for lead/manual tests until later phases.

- [x] **Step 1: Write failing tests**

Add tests asserting:

```js
assert.equal(FakeExecutor.lastRunMaxTurns, Number.POSITIVE_INFINITY);
```

for both sub-agent and teammate paths.

- [x] **Step 2: Run red tests**

Run:

```bash
node --test server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js
```

Expected: FAIL because child runs still use finite/default turns.

- [x] **Step 3: Implement unbounded child execution**

Call child executors with `Number.POSITIVE_INFINITY`. Keep parent/lead finite loop behavior unchanged.

- [x] **Step 4: Deprecate teammate maxTurns handling**

Keep `maxTurns` in schema/tool input for compatibility, but do not pass it to `runTeammate`. Remove assertions that clamp `maxTurns` as active behavior and replace with an ignored-legacy-input test.

- [x] **Step 5: Run targeted tests**

Run:

```bash
node --test server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js server/agent/plugins/TeamPlugin.test.js server/agent/AgentExecutor.stream.test.js
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/agent/subAgentProfile.js server/agent/teams/teammateRunner.js server/agent/plugins/TeamPlugin.js server/agent/plugins/TeamPlugin.test.js server/agent/teams/teammateRunner.test.js server/agent/AgentExecutor.stream.test.js
git commit -m "feat: make child agent runs unbounded"
```

### Task 4: Frontend Permission Source Preservation

**Files:**
- Modify: `src/hooks/useAgentLoop.js`
- Modify: `src/components/TrajectoryView.jsx`
- Create or modify tests if existing frontend utilities can cover the formatting.

**Interfaces:**
- Permission state includes `runtimeRole`, `childType`, `childId`, `teammateId`, `teammateName`, `teammateRole`, and `parentToolCallId`.
- UI displays `Sub-agent` and `Teammate` source labels.

- [x] **Step 1: Add presentation helper test if needed**

If no existing helper exists, create a small helper for permission source labels and test lead/sub-agent/teammate formatting.

- [x] **Step 2: Implement source display**

Update permission modal to show sub-agent source, not only teammate source.

- [x] **Step 3: Run frontend tests/build**

Run:

```bash
node --test src/lib/*.test.js
npm run build
```

Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/hooks/useAgentLoop.js src/components/TrajectoryView.jsx src/lib
git commit -m "feat: show child permission sources"
```

### Task 5: Phase 1 Verification

**Files:**
- No planned production files unless verification finds a defect.

**Interfaces:**
- Whole Phase 1 must build and targeted tests must pass.

- [x] **Step 1: Run full targeted backend suite**

Run:

```bash
node --test server/agent/child/*.test.js server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js server/agent/plugins/TeamPlugin.test.js server/agent/plugins/SecurityPlugin.test.js server/agent/AgentExecutor.stream.test.js
```

Expected: PASS.

- [x] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [x] **Step 3: Check git status**

Run: `git status --short`

Expected: clean.
