# Runtime Roadmap Consolidated Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the active plan folder focused on the current runtime roadmap after the reliability, child-agent profile, and security hardening workstreams have converged.

**Architecture:** Completed historical plans are archived as implementation records. This plan is the single active roadmap for remaining runtime reliability, security, teams-v2, and maintainability work. Each future task should either update this file or split into a new active plan only when it becomes a concrete implementation batch.

**Tech Stack:** Node.js ES modules, Express SSE, `AgentExecutor`/HookManager plugins, React 19, Vite, Node test runner, macOS `sandbox-exec` for current local bash sandboxing.

## Global Constraints

- Keep the project experimental and modular; avoid opaque product-style orchestration that hides primitives.
- Do not solve runtime correctness by only changing prompts, increasing max turns, or hiding UI output.
- Preserve Anthropic-compatible protocol behavior and DeepSeek model compatibility.
- Keep child-agent and teammate traces lazy-loaded and bounded in primary trajectory UI.
- Prefer shared child-agent primitives over one-off `sub_agent` / `teammate` forks.
- Every implementation batch must add regression tests before code changes.
- Every implementation batch should end in a small commit.

---

## Archived Plans

The following plans have been moved to `docs/superpowers/plans/archive/`:

- `2026-06-28-agent-runtime-reliability-contracts.md`
- `2026-06-29-agent-harness-profiles-phase1.md`
- `2026-06-29-agent-harness-profiles-phase2.md`
- `2026-06-29-agent-harness-profiles-phase3.md`
- `2026-06-30-agent-harness-profiles-phase4.md`
- `2026-06-30-agent-harness-profiles-phase5.md`
- `2026-06-30-security-runtime-hardening.md`

They are no longer active execution plans. They remain useful as implementation history and design context.

## Current Completed Baseline

The following capabilities are already implemented and covered by tests:

- Runtime trace-inspection mode can disable tools for questions about previous tool calls.
- Tool invocation validation marks malformed calls as typed `invalid_args` before execution.
- Teammate/sub-agent final outcome handling rejects tool-only output as `no_result` instead of pretending it is a valid report.
- Frontend run view model separates live stream state from persisted session snapshots to avoid phantom overwrites.
- Memory injection/extraction is disabled for trace-inspection turns.
- Sub-agent and teammate cards share child status presentation, permission-wait visibility, and lazy trace loading.
- Child-agent profiles share feature/tool filtering, scratch workspace policy, and unbounded child run semantics.
- `read_file` / `write_file` enforce workspace path policy and sensitive-file denial.
- Bash foreground and background execution share a macOS sandbox boundary plus sensitive-output redaction.
- Permanent sensitive-file security blocks stop the agent loop after one blocked attempt instead of triggering repeated bypass attempts.
- Harness creation has collision checks.
- Legacy `/api/chat` is disabled with `410`.
- Frontend API calls go through a central API boundary.
- React Error Boundary protects the app from full white-screen crashes.
- `npm test` and `npm run build` currently pass.

## Active Roadmap

### Task 1: Cross-Platform Runtime Sandbox Boundary

**Goal:** Make the bash execution boundary explicit across platforms instead of relying only on macOS `sandbox-exec`.

**Files:**
- Modify: `server/tools/bashSandbox.js`
- Modify: `server/tools/bash.js`
- Modify: `server/agent/AgentExecutor.js`
- Test: `server/tools/toolValidation.test.js`
- Create if needed: `server/tools/bashSandbox.test.js`

**Interfaces:**
- Consumes: `buildBashSpawnInvocation(command, options)`.
- Produces: a platform capability object such as `{ command, args, sandboxed, redactionOnly, reason }`.

- [ ] **Step 1: Write platform capability tests**

Test that macOS returns `sandboxed: true` when `sandbox-exec` exists, and non-macOS returns an explicit `redactionOnly: true` or configured alternative instead of silently claiming sandboxing.

- [ ] **Step 2: Add a user-visible degraded-sandbox marker**

When process-level sandboxing is unavailable, tool output and logs should identify that only command preflight plus redaction are active.

- [ ] **Step 3: Add environment allowlist option**

Evaluate replacing `...process.env` passed to bash with an explicit environment allowlist, keeping only variables needed for local tooling and model-independent execution.

- [ ] **Step 4: Verify**

Run:

```bash
node --test server/tools/toolValidation.test.js server/tools/bashSandbox.test.js
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server/tools/bashSandbox.js server/tools/bash.js server/agent/AgentExecutor.js server/tools/*test.js
git commit -m "fix: make bash sandbox capability explicit"
```

### Task 2: Local API Access Guard and Rate Limits

**Goal:** Prevent accidental exposure of local runtime APIs and reduce runaway API cost or DoS risk.

**Files:**
- Modify: `server.js`
- Create if needed: `server/http/accessGuard.js`
- Create if needed: `server/http/accessGuard.test.js`

**Interfaces:**
- Produces: Express middleware for local-only or token-guarded API access.
- Produces: lightweight per-route or global rate limiter suitable for local experimental use.

- [ ] **Step 1: Write request-level guard tests**

Cover allowed localhost requests, rejected non-localhost requests when no token is configured, and accepted token-authenticated requests.

- [ ] **Step 2: Implement access guard middleware**

Keep default local-dev behavior frictionless, but make non-local exposure require explicit configuration.

- [ ] **Step 3: Add minimal rate limiting**

Start with in-memory token buckets for `/api/agent/run`, `/api/models`, and file-mutating endpoints.

- [ ] **Step 4: Verify**

Run:

```bash
node --test server/http/accessGuard.test.js
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server.js server/http/accessGuard.js server/http/accessGuard.test.js
git commit -m "fix: guard local runtime api access"
```

### Task 3: Server Boundary Split

**Goal:** Reduce `server.js` blast radius by extracting route and lifecycle boundaries without changing behavior.

**Files:**
- Modify: `server.js`
- Create if needed: `server/routes/harnessRoutes.js`
- Create if needed: `server/routes/modelRoutes.js`
- Create if needed: `server/routes/agentRunRoutes.js`
- Create if needed: `server/agent/activeJobs.js`

**Interfaces:**
- Produces: route registration functions that accept `{ app, dependencies }`.
- Produces: an `activeJobs` helper with explicit reserve, attach, release, and list semantics.

- [ ] **Step 1: Write behavior-preserving route tests**

Cover harness loading/saving, model config parsing/upsert, and active job reservation.

- [ ] **Step 2: Extract one route group at a time**

Move harness routes first, then model routes, then agent run routes. Do not mix behavior changes into this task.

- [ ] **Step 3: Extract active job lifecycle helper**

Keep the existing concurrency semantics, but make reservation and release paths testable.

- [ ] **Step 4: Verify**

Run:

```bash
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server.js server/routes server/agent/activeJobs.js
git commit -m "refactor: split server route boundaries"
```

### Task 4: Shared Streaming Parser

**Goal:** Remove duplicated Anthropic-compatible SSE parsing and make DeepSeek/Anthropic deltas easier to test in one place.

**Files:**
- Modify: `server/agent/AgentExecutor.js`
- Create if needed: `server/agent/llmStreamParser.js`
- Create if needed: `server/agent/llmStreamParser.test.js`

**Interfaces:**
- Produces: parser that converts provider SSE events into normalized runtime events.
- Consumes: existing `_callLLM` event handling and any remaining legacy stream path.

- [ ] **Step 1: Write parser fixture tests**

Cover thinking, text, tool_use, malformed JSON lines, and message_delta stop reasons.

- [ ] **Step 2: Implement parser without changing public events**

The first implementation should preserve existing message shapes and SSE events.

- [ ] **Step 3: Rewire `AgentExecutor._callLLM`**

Replace inline switch parsing with the shared parser.

- [ ] **Step 4: Verify**

Run:

```bash
node --test server/agent/llmStreamParser.test.js server/agent/AgentExecutor.stream.test.js
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server/agent/AgentExecutor.js server/agent/llmStreamParser.js server/agent/llmStreamParser.test.js
git commit -m "refactor: extract llm stream parser"
```

### Task 5: Teams v2 Minimal Closure

**Goal:** Preserve the experimental primitive model while making Async Teams more observable, reliable, and easy to test.

**Files:**
- Modify: `server/agent/plugins/TeamPlugin.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `src/components/MessageBubbles.jsx`
- Modify: `src/lib/childStatusPresentation.js`
- Test: `server/agent/plugins/TeamPlugin.test.js`
- Test: `server/agent/teams/teammateRunner.test.js`
- Test: `src/lib/childStatusPresentation.test.js`

**Interfaces:**
- Consumes: current team bus, teammate trace store, child event bridge, and shared child presentation helpers.
- Produces: clearer teammate lifecycle states and safer lead-facing summaries.

- [ ] **Step 1: Define Teams v2 lifecycle states**

Keep states finite: `running`, `awaiting_permission`, `completed`, `failed`, `no_result`, and future `cancelled`.

- [ ] **Step 2: Add observability tests**

Cover spawn cards, wait cards, no-result inbox, permission waits, and lazy trace availability.

- [ ] **Step 3: Improve lead-facing status text**

Make wait output always tell the lead whether to call `check_team_inbox`, wait longer, or report partial results.

- [ ] **Step 4: Verify**

Run:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/agent/teams/teammateRunner.test.js src/lib/childStatusPresentation.test.js
npm test
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server/agent/plugins/TeamPlugin.js server/agent/teams/teammateRunner.js src/components/MessageBubbles.jsx src/lib/childStatusPresentation.js
git commit -m "feat: improve teams v2 observability"
```

## Active Acceptance Criteria

- `docs/superpowers/plans/` contains only this active roadmap unless a new concrete implementation batch is intentionally split out.
- Completed historical plans live under `docs/superpowers/plans/archive/`.
- `npm test` passes before merging a runtime-roadmap batch.
- `npm run build` passes before merging a frontend-impacting batch.
- Any future plan split must state why it cannot be tracked as a task in this consolidated roadmap.

## Notes

- This roadmap intentionally does not reintroduce child-agent turn limits. The current direction is to remove arbitrary child turn caps and rely on runtime contracts, observability, permission flow, and cancellation semantics.
- This roadmap treats `sub_agent` and `agent_teams` as harness-profile compositions over shared child-agent primitives.
- Commercial-style strategy presets can be added later, but the experimental platform must keep primitives independently toggleable.
