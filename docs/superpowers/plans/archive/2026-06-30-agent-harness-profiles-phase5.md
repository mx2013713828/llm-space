# Agent Harness Profiles Phase 5 Implementation Plan

Status: Completed on 2026-06-30.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove child-agent legacy compatibility branches that kept `turn_limit`, `maxTurns`, and old orchestration prompt migrations alive.

**Architecture:** Child/team runtime outcome and presentation now use the canonical states only: `running`, `awaiting_permission`, `completed`, `failed`, `cancelled`, and `no_result`. Public teammate tool schema no longer advertises turn budgets. Feature parsing no longer rewrites legacy prompt text; current harness configuration is expected to use the canonical schema.

**Tech Stack:** Node.js ESM, `node:test`, existing FeatureSchema, ToolRegistry, child outcome, and team runtime modules.

**Completed Commits:**

- `ce827ff docs: plan agent harness profiles phase 5`
- `57948d6 refactor: remove child turn limit compatibility`
- `ec3dda0 refactor: remove teammate maxTurns schema`
- `489dd1e refactor: remove legacy prompt migration`
- `19b2606 test: remove legacy state literals from presentation tests`

## Global Constraints

- Clean thoroughly; old harness compatibility does not need to be retained.
- Do not rewrite the lead `AgentExecutor.run(maxTurns = 15)` loop in this phase; it remains a lead/runtime safety guard until the later cancellation/stop-policy refactor.
- Remove child/team product semantics for `turn_limit`.
- Remove `spawn_teammate.maxTurns` from public tool schema and tests.
- Remove legacy prompt auto-migration from `parseFeatures`.
- Use TDD: write failing tests before production code.
- Commit each phase task separately.

---

## File Structure

- Modify `server/agent/child/childOutcome.js`
  - Remove the `stopReason === 'turn_limit'` compatibility branch and the `legacyMaxTurns` parameter.
- Modify `server/agent/child/childOutcome.test.js`
  - Delete the legacy turn-limit mapping test.
- Modify `server/agent/teams/teammateOutcome.test.js`
  - Delete the legacy turn-limit mapping test.
- Modify `server/agent/teams/teammateRunner.test.js`
  - Delete the fake child `turn_limit` scenario.
- Modify `src/lib/childStatusPresentation.js` and `src/lib/runtimeStatusPresentation.js`
  - Remove `turn_limit` from canonical presentation maps.
- Modify related frontend presentation tests
  - Assert canonical states only.
- Modify `server/tools/spawn_teammate.js`
  - Remove `maxTurns` parameter from the schema.
- Modify `server/tools/ToolRegistry.test.js`
  - Assert the schema no longer includes `maxTurns`.
- Modify `server/agent/plugins/TeamPlugin.test.js`
  - Remove teammate spawn tests that pass legacy `maxTurns`.
- Modify `src/lib/FeatureSchema.js`
  - Remove `LEGACY_TEXT_AREA_DEFAULTS` and `normalizeTextAreaValue`.
- Modify `src/lib/FeatureSchema.test.js`
  - Replace legacy migration tests with canonical prompt preservation tests.
- Modify `docs/superpowers/specs/2026-06-29-agent-harness-profiles-design.md`
  - Mark Phase 5 complete and clarify that old prompt migration was removed.
- Modify this plan file
  - Track completed tasks and commits.

---

### Task 1: Remove Child/Team `turn_limit` Outcome and Display Compatibility

**Files:**
- Modify: `server/agent/child/childOutcome.js`
- Modify: `server/agent/child/childOutcome.test.js`
- Modify: `server/agent/teams/teammateOutcome.test.js`
- Modify: `server/agent/teams/teammateRunner.test.js`
- Modify: `src/lib/childStatusPresentation.js`
- Modify: `src/lib/childStatusPresentation.test.js`
- Modify: `src/lib/runtimeStatusPresentation.js`
- Modify: `src/lib/runtimeStatusPresentation.test.js`

**Interfaces:**
- Produces: `buildChildOutcome({ messages, stopReason, childLabel, requireFinalText })`
- Produces: child presentation maps without `turn_limit`
- Consumes: existing child outcome contract for `completed`, `cancelled`, and `no_result`

- [x] **Step 1: Write failing tests**

Update tests so `turn_limit` is no longer a canonical state:

```js
assert.notEqual(getChildStatusPresentation({ state: 'turn_limit' }).label, 'turn limit');
assert.notDeepEqual(getTeammateStatusPresentation({ state: 'turn_limit' }), {
  label: 'turn limit',
  tone: 'danger',
});
```

Delete the tests that expect `buildChildOutcome` or `buildTeammateOutcome` to map `stopReason: 'turn_limit'` to a legacy no-result message.

- [x] **Step 2: Verify red**

Run:

```bash
node --test server/agent/child/childOutcome.test.js server/agent/teams/teammateOutcome.test.js src/lib/childStatusPresentation.test.js src/lib/runtimeStatusPresentation.test.js
```

Expected: FAIL because the presentation maps still contain `turn_limit`.

- [x] **Step 3: Implement cleanup**

Remove:

- `legacyMaxTurns` from `buildChildOutcome` arguments
- `stopReason === 'turn_limit'` branch in `buildChildOutcome`
- `turn_limit` from `CHILD_STATUS`
- `turn_limit` from `TEAMMATE_STATUS`
- fake runner test that sets `lastRunStopReason = 'turn_limit'`

- [x] **Step 4: Verify green**

Run:

```bash
node --test server/agent/child/childOutcome.test.js server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.test.js src/lib/childStatusPresentation.test.js src/lib/runtimeStatusPresentation.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/agent/child/childOutcome.js server/agent/child/childOutcome.test.js server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.test.js src/lib/childStatusPresentation.js src/lib/childStatusPresentation.test.js src/lib/runtimeStatusPresentation.js src/lib/runtimeStatusPresentation.test.js
git commit -m "refactor: remove child turn limit compatibility"
```

---

### Task 2: Remove Public `spawn_teammate.maxTurns`

**Files:**
- Modify: `server/tools/spawn_teammate.js`
- Modify: `server/tools/ToolRegistry.test.js`
- Modify: `server/agent/plugins/TeamPlugin.test.js`
- Modify: `server/agent/teams/teammateRunner.test.js`

**Interfaces:**
- Produces: `spawn_teammate` schema without `maxTurns`
- Consumes: existing structured brief fields: `name`, `role`, `prompt`, `objective`, `constraints`, `expected_output`, `success_criteria`

- [x] **Step 1: Write failing tests**

In `ToolRegistry.test.js`, assert:

```js
const spawnSchema = toolRegistry.getSchemas(['spawn_teammate'])[0];
assert.equal(spawnSchema.input_schema.properties.maxTurns, undefined);
```

Remove `maxTurns` from all `spawn_teammate` test inputs and from `runTeammate` test inputs.

- [x] **Step 2: Verify red**

Run:

```bash
node --test server/tools/ToolRegistry.test.js server/agent/plugins/TeamPlugin.test.js server/agent/teams/teammateRunner.test.js
```

Expected: FAIL because `spawn_teammate` still advertises `maxTurns`.

- [x] **Step 3: Implement cleanup**

Delete the `maxTurns` parameter from `server/tools/spawn_teammate.js`.

- [x] **Step 4: Verify green**

Run:

```bash
node --test server/tools/ToolRegistry.test.js server/agent/plugins/TeamPlugin.test.js server/agent/teams/teammateRunner.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/tools/spawn_teammate.js server/tools/ToolRegistry.test.js server/agent/plugins/TeamPlugin.test.js server/agent/teams/teammateRunner.test.js
git commit -m "refactor: remove teammate maxTurns schema"
```

---

### Task 3: Remove Old Harness Prompt Migration

**Files:**
- Modify: `src/lib/FeatureSchema.js`
- Modify: `src/lib/FeatureSchema.test.js`

**Interfaces:**
- Produces: `parseFeatures(inputFeatures)` without old prompt rewrite behavior
- Consumes: canonical `FEATURE_SCHEMA.task_orchestration.children.*_prompt.defaultValue`

- [x] **Step 1: Write failing tests**

Replace the legacy migration test with a preservation test:

```js
const legacyPrompt = `<execution_strategy id="custom">
No strategy guideline is active. Follow the currently enabled primitives and the user's instructions.
</execution_strategy>`;

const parsed = parseFeatures({
  task_orchestration: {
    custom_strategy_prompt: legacyPrompt,
  },
}).task_orchestration;

assert.equal(parsed.custom_strategy_prompt, legacyPrompt);
```

This asserts old prompt text is treated as user-provided config, not silently rewritten.

- [x] **Step 2: Verify red**

Run:

```bash
node --test src/lib/FeatureSchema.test.js
```

Expected: FAIL because old prompt text is currently migrated to the canonical default.

- [x] **Step 3: Implement cleanup**

Delete:

- `LEGACY_TEXT_AREA_DEFAULTS`
- `normalizeTextAreaValue`
- the `normalizeTextAreaValue(...)` call in text-area parsing

Text-area parsing should assign `rawValue` directly when the group is enabled or preserves disabled children.

- [x] **Step 4: Verify green**

Run:

```bash
node --test src/lib/FeatureSchema.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/FeatureSchema.js src/lib/FeatureSchema.test.js
git commit -m "refactor: remove legacy prompt migration"
```

---

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-06-29-agent-harness-profiles-design.md`
- Modify: `docs/superpowers/plans/2026-06-30-agent-harness-profiles-phase5.md`
- Modify if needed: `docs/memory/plan.md`
- Modify if needed: `docs/memory/status.md`

**Interfaces:**
- Consumes: completed Task 1-3 commits.
- Produces: documented Phase 5 completion state.

- [x] **Step 1: Update docs**

Mark Phase 5 complete in the design:

```markdown
1. Done: Remove `maxTurns` from child spawn schemas.
2. Done: Remove child/team `turn_limit` compatibility outcome and display branches.
3. Done: Remove old prompt migration branches.
4. Done: Delete obsolete tests that encode turn-limit behavior.
```

Record Task 1-3 commit hashes in this plan.

- [x] **Step 2: Run targeted source scan**

Run:

```bash
rg "turn_limit|legacy turn|legacyMaxTurns|maxTurns" server src -g '!server/sessions/**'
```

Expected: only lead `AgentExecutor.run(maxTurns)` safety-loop references, schema absence assertions, and unbounded child adapter tests may remain.

Observed on 2026-06-30: matched only the lead executor safety loop/stream test, `spawn_teammate` schema absence assertion, and child adapter tests that assert unbounded child execution.

- [x] **Step 3: Run full verification**

Run:

```bash
node --test $(rg --files -g '*test.js' | sort)
npm run build
```

Expected: all tests pass and build succeeds.

Observed on 2026-06-30:

- `node --test $(rg --files -g '*test.js' | sort)`: 278 passed.
- `npm run build`: passed.

- [x] **Step 4: Commit docs**

```bash
git add -f docs/superpowers/specs/2026-06-29-agent-harness-profiles-design.md docs/superpowers/plans/2026-06-30-agent-harness-profiles-phase5.md docs/memory/plan.md docs/memory/status.md
git commit -m "docs: mark legacy cleanup phase complete"
```

## Self-Review

- Spec coverage: Covers all Phase 5 bullets plus the user's request to stop preserving old harness prompt migration behavior.
- Placeholder scan: No placeholder text remains.
- Type consistency: Function names and file paths match current code.
