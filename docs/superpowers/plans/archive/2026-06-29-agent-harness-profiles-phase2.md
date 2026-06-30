# Agent Harness Profiles Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract child-agent profile builders and scratch policy so sub-agents, teammates, and future reviewer/verifier profiles share feature, tool, prompt, and scratch decisions.

**Architecture:** Add shared child profile modules under `server/agent/child/`. Keep existing sub-agent and teammate adapter exports stable by turning them into wrappers over profile builders. Scratch policy is declarative metadata and prompt guidance in this phase; security approval remains enforced by existing tool/security flow.

**Tech Stack:** Node.js ESM, `node:test`, existing `AgentExecutor`, current plugin/tool registry, React/Vite untouched except existing tests.

**Completed:** 2026-06-29

**Phase 2 Commits:**
- `89bd76a feat: add child agent profile policies`
- `7beea2b refactor: use shared child profiles`
- `eb88dc6 feat: add reviewer verifier child profiles`
- `9fc45c6 feat: add child scratch workspace policy`

**Verification:**
- `node --test $(rg --files -g '*test.js' | sort)` — PASS, 267 tests
- `npm run build` — PASS

## Global Constraints

- `sub_agent` and teammates are harness profiles over the same executor runtime.
- Do not merge TeamBus into the child runtime.
- Do not make all child agents read-only.
- Scratch workspace path is `.agent-scratch/<runId>/<childId>/`.
- `/tmp` and outside-workspace paths remain suspicious or blocked by existing security rules.
- Preserve current public adapter exports for compatibility.
- Follow TDD: write failing tests, verify red, implement minimal code, verify green, then commit.

---

### Task 1: Shared Child Profile Policies

**Files:**
- Create: `server/agent/child/childAgentProfile.js`
- Create: `server/agent/child/childAgentProfile.test.js`

**Interfaces:**
- Produces: `createChildFeatures(parentFeatures, policy)`
- Produces: `selectChildTools(parentTools, policy)`
- Produces: `createChildAgentProfile(args)`
- Policy fields:
  - `taskOrchestration: object`
  - `memoryEnabled: boolean`
  - `toolFilter: 'managed_orchestration' | 'hidden_orchestration'`
  - `appendTools: string[]`
  - `systemPrompt: string`

- [x] **Step 1: Write failing policy tests**

Add tests asserting:

```js
const features = createChildFeatures(parentFeatures, {
  taskOrchestration: { enabled: false, enable_sub_agents: false },
  memoryEnabled: false,
});
assert.equal(features.task_orchestration.enabled, false);
assert.equal(features.enable_memory.enabled, false);
```

And:

```js
const tools = selectChildTools(
  ['bash', 'sub_agent', 'write_todos', 'send_team_message', { name: 'custom_tool' }],
  { toolFilter: 'hidden_orchestration', appendTools: ['send_team_message'] },
);
assert.deepEqual(tools, ['bash', { name: 'custom_tool' }, 'send_team_message']);
```

- [x] **Step 2: Run red test**

Run: `node --test server/agent/child/childAgentProfile.test.js`

Expected: FAIL because `server/agent/child/childAgentProfile.js` does not exist.

- [x] **Step 3: Implement shared policies**

Create `childAgentProfile.js` with `createChildFeatures`, `selectChildTools`, and `createChildAgentProfile`. Use `structuredClone`, `getToolName`, `ORCHESTRATION_MANAGED_TOOL_NAMES`, and `TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES`.

- [x] **Step 4: Run green test**

Run: `node --test server/agent/child/childAgentProfile.test.js`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/agent/child/childAgentProfile.js server/agent/child/childAgentProfile.test.js
git commit -m "feat: add child agent profile policies"
```

### Task 2: Adapter Profile Rewire

**Files:**
- Modify: `server/agent/subAgentProfile.js`
- Modify: `server/agent/subAgentProfile.test.js`
- Modify: `server/agent/teams/teammateProfile.js`
- Modify: `server/agent/teams/teammateProfile.test.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `server/agent/plugins/SubAgentPlugin.test.js`
- Modify: `server/agent/teams/teammateRunner.test.js`

**Interfaces:**
- Produces: `createSubAgentProfile({ parentExecutor, prompt, childId })`
- Produces: `createTeammateProfile({ parentExecutor, teamId, teammateId, name, role, initialPrompt, cwd })`
- Existing exports `createSubAgentFeatures`, `selectSubAgentTools`, `createTeammateFeatures`, and `selectTeammateTools` remain available.

- [x] **Step 1: Write failing adapter tests**

Add assertions that `createSubAgentProfile` returns `messages`, `systemPrompt`, `tools`, `features`, and `identity.childType === 'sub_agent'`. Add assertions that `createTeammateProfile` returns `runtimeRole === 'teammate'`, `teamContext`, `tools` including only `send_team_message` from team tools, and memory disabled.

- [x] **Step 2: Run red tests**

Run:

```bash
node --test server/agent/subAgentProfile.test.js server/agent/teams/teammateProfile.test.js
```

Expected: FAIL because profile builder exports do not exist.

- [x] **Step 3: Rewire adapters**

Make sub-agent and teammate profile modules call shared `createChildAgentProfile`. Make `runSubAgent` and `runTeammate` construct child executors from the returned profile object instead of repeating policy logic inline.

- [x] **Step 4: Run targeted tests**

Run:

```bash
node --test server/agent/subAgentProfile.test.js server/agent/teams/teammateProfile.test.js server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js server/agent/AgentExecutor.orchestration.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/agent/subAgentProfile.js server/agent/subAgentProfile.test.js server/agent/teams/teammateProfile.js server/agent/teams/teammateProfile.test.js server/agent/teams/teammateRunner.js server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js
git commit -m "refactor: use shared child profiles"
```

### Task 3: Reviewer and Verifier Profile Presets

**Files:**
- Modify: `server/agent/child/childAgentProfile.js`
- Modify: `server/agent/child/childAgentProfile.test.js`

**Interfaces:**
- Produces: `createReviewerProfile({ parentExecutor, prompt, childId, role })`
- Produces: `createVerifierProfile({ parentExecutor, prompt, childId, role })`

- [x] **Step 1: Write failing preset tests**

Add tests asserting reviewer profile disables memory, strips delegation/team/scheduling tools, and system prompt says it is read-only by default. Add tests asserting verifier profile disables memory, strips orchestration tools, keeps atomic verification tools such as `bash` and `write_file`, and includes scratch guidance placeholder from its profile.

- [x] **Step 2: Run red test**

Run: `node --test server/agent/child/childAgentProfile.test.js`

Expected: FAIL because reviewer/verifier exports do not exist.

- [x] **Step 3: Implement presets**

Add `createReviewerProfile` and `createVerifierProfile` using shared policies. Reviewer uses `toolFilter: 'hidden_orchestration'` and removes write-oriented tool names (`write_file`, `replace_file_content`, `multi_replace_file_content`, `run_command`) from its selected tools. Verifier uses `toolFilter: 'hidden_orchestration'` and keeps atomic tools for verification.

- [x] **Step 4: Run green test**

Run: `node --test server/agent/child/childAgentProfile.test.js`

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/agent/child/childAgentProfile.js server/agent/child/childAgentProfile.test.js
git commit -m "feat: add reviewer verifier child profiles"
```

### Task 4: Scratch Workspace Policy

**Files:**
- Create: `server/agent/child/scratchWorkspacePolicy.js`
- Create: `server/agent/child/scratchWorkspacePolicy.test.js`
- Modify: `server/agent/child/childAgentProfile.js`
- Modify: `server/agent/child/childAgentProfile.test.js`
- Modify: `server/agent/subAgentProfile.test.js`
- Modify: `server/agent/teams/teammateProfile.test.js`

**Interfaces:**
- Produces: `createScratchWorkspacePolicy({ runId, childId, rootDir })`
- Produces: `isPathInsideScratch(filePath, scratchPolicy)`
- Profile field: `scratchWorkspace`
- System prompt guidance includes `.agent-scratch/<runId>/<childId>/` when scratch is enabled.

- [x] **Step 1: Write failing scratch tests**

Add tests asserting:

```js
const policy = createScratchWorkspacePolicy({ runId: 'run/1', childId: 'child:2', rootDir: '/workspace/app' });
assert.equal(policy.relativePath, '.agent-scratch/run_1/child_2');
assert.equal(isPathInsideScratch('.agent-scratch/run_1/child_2/tmp.js', policy), true);
assert.equal(isPathInsideScratch('/tmp/tmp.js', policy), false);
```

- [x] **Step 2: Run red test**

Run: `node --test server/agent/child/scratchWorkspacePolicy.test.js`

Expected: FAIL because module does not exist.

- [x] **Step 3: Implement scratch policy**

Create path sanitization that replaces non `[A-Za-z0-9_-]` characters with `_`, trims to 80 characters, and prevents empty IDs. Return absolute and relative scratch paths. Implement `isPathInsideScratch` with `path.resolve`.

- [x] **Step 4: Attach scratch to profiles**

Enable scratch for sub-agent, teammate, and verifier profiles. Disable scratch for reviewer profile. Append prompt guidance only when scratch is enabled.

- [x] **Step 5: Run targeted tests**

Run:

```bash
node --test server/agent/child/scratchWorkspacePolicy.test.js server/agent/child/childAgentProfile.test.js server/agent/subAgentProfile.test.js server/agent/teams/teammateProfile.test.js server/agent/plugins/SubAgentPlugin.test.js server/agent/teams/teammateRunner.test.js
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add server/agent/child/scratchWorkspacePolicy.js server/agent/child/scratchWorkspacePolicy.test.js server/agent/child/childAgentProfile.js server/agent/child/childAgentProfile.test.js server/agent/subAgentProfile.test.js server/agent/teams/teammateProfile.test.js
git commit -m "feat: add child scratch workspace policy"
```

### Task 5: Phase 2 Verification and Documentation

**Files:**
- Modify: `docs/superpowers/plans/2026-06-29-agent-harness-profiles-phase2.md`

- [x] **Step 1: Run full tests**

Run:

```bash
node --test $(rg --files -g '*test.js' | sort)
```

Expected: PASS.

- [x] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [x] **Step 3: Mark plan complete**

Update this plan with completion date, commits, and verification commands.

- [x] **Step 4: Commit**

```bash
git add -f docs/superpowers/plans/2026-06-29-agent-harness-profiles-phase2.md
git commit -m "docs: mark child profile phase 2 complete"
```
