# Runtime Roadmap Consolidated Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the active plan folder focused on the current runtime roadmap after the reliability, child-agent profile, and security hardening workstreams have converged.

**Architecture:** Completed historical plans are archived as implementation records. This plan is the single active roadmap for remaining runtime reliability, security, teams-v2, memory governance, model/API abstraction, knowledge mounting, and maintainability work. Each future task should either update this file or split into a new active plan only when it becomes a concrete implementation batch.

**Tech Stack:** Node.js ES modules, Express SSE, `AgentExecutor`/HookManager plugins, React 19, Vite, Node test runner, macOS `sandbox-exec` for current local bash sandboxing, local filesystem-backed stores for experimental memory and knowledge artifacts.

## Global Constraints

- Keep the project experimental and modular; avoid opaque product-style orchestration that hides primitives.
- Do not solve runtime correctness by only changing prompts, increasing max turns, or hiding UI output.
- Preserve Anthropic-compatible protocol behavior and DeepSeek model compatibility.
- Keep child-agent and teammate traces lazy-loaded and bounded in primary trajectory UI.
- Prefer shared child-agent primitives over one-off `sub_agent` / `teammate` forks.
- Treat memory, model provider access, and knowledge bases as mountable runtime resources, not hard-coded prompt text.
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

- [x] **Step 1: Write platform capability tests**

Test that macOS returns `sandboxed: true` when `sandbox-exec` exists, and non-macOS returns an explicit `redactionOnly: true` or configured alternative instead of silently claiming sandboxing.

- [x] **Step 2: Add a user-visible degraded-sandbox marker**

When process-level sandboxing is unavailable, tool output and logs should identify that only command preflight plus redaction are active.

- [x] **Step 3: Add environment allowlist option**

Evaluate replacing `...process.env` passed to bash with an explicit environment allowlist, keeping only variables needed for local tooling and model-independent execution.

- [x] **Step 4: Verify**

Run:

```bash
node --test server/tools/toolValidation.test.js server/tools/bashSandbox.test.js
npm test
npm run build
```

- [x] **Step 5: Commit**

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

- [x] **Step 1: Write request-level guard tests**

Cover allowed localhost requests, rejected non-localhost requests when no token is configured, and accepted token-authenticated requests.

- [x] **Step 2: Implement access guard middleware**

Keep default local-dev behavior frictionless, but make non-local exposure require explicit configuration.

- [x] **Step 3: Add minimal rate limiting**

Start with in-memory token buckets for `/api/agent/run`, `/api/models`, and file-mutating endpoints.

- [x] **Step 4: Verify**

Run:

```bash
node --test server/http/accessGuard.test.js
npm test
npm run build
```

- [x] **Step 5: Commit**

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

### Task 6: Candidate Memory Queue

**Goal:** Stop writing extracted memories directly into long-term memory; instead stage memory candidates for review, approval, rejection, and later consolidation.

**MVP Shape:** Memory extraction creates candidate records with source run metadata and confidence. The UI exposes a small review queue where users can approve, edit, reject, or bulk clear candidates. Approved candidates become ordinary memories using the existing memory store.

**Files:**
- Modify: `server/agent/plugins/MemoryPlugin.js`
- Modify: `server/agent/memory/memoryExtract.js`
- Modify: `server/agent/memory/memoryStore.js`
- Create: `server/agent/memory/memoryCandidateStore.js`
- Create: `server/agent/memory/memoryCandidateStore.test.js`
- Create: `server/agent/memory/memoryCandidateApi.test.js`
- Modify: `server.js` or future extracted memory routes
- Modify: `src/pages/PromptLabPage.jsx` or create a focused memory queue panel
- Create: `src/lib/memoryCandidates.test.js`

**Interfaces:**
- Produces: `createMemoryCandidate({ harnessId, scope, source, content, reason, confidence })`.
- Produces: `listMemoryCandidates({ harnessId, status })`.
- Produces: `approveMemoryCandidate(candidateId, patch)` and `rejectMemoryCandidate(candidateId, reason)`.
- Consumes: existing `memoryStore` write path for approved candidates.

- [ ] **Step 1: Write candidate store tests**

Cover candidate creation, per-harness listing, approval status transition, rejection status transition, and stable persistence across reloads.

- [ ] **Step 2: Implement candidate store**

Use a filesystem-backed JSONL or JSON store under `server/sessions/<harnessId>_memory_candidates.json` with append-safe writes. Candidate records must include `id`, `harnessId`, `status`, `content`, `source`, `confidence`, `createdAt`, and `updatedAt`.

- [ ] **Step 3: Rewire memory extraction to candidate mode**

Change extraction so new memories are staged as `pending` candidates by default. Keep a feature flag such as `enable_memory.auto_approve_candidates` for experimental direct-write behavior, defaulting to false.

- [ ] **Step 4: Add review API**

Expose endpoints for list, approve, reject, and clear rejected candidates. Approval should write through to the existing memory store and mark the candidate `approved`.

- [ ] **Step 5: Add lightweight queue UI**

Add a compact queue panel showing pending candidates, source run, confidence, approve/edit/reject actions, and an empty state. Avoid embedding long source traces; link to existing trajectory context when available.

- [ ] **Step 6: Verify**

Run:

```bash
node --test server/agent/memory/memoryCandidateStore.test.js server/agent/memory/memoryCandidateApi.test.js
node --test server/agent/plugins/MemoryPlugin.test.js
node --test src/lib/memoryCandidates.test.js
npm test
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add server/agent/memory server/agent/plugins/MemoryPlugin.js server.js src
git commit -m "feat: add memory candidate review queue"
```

### Task 7: Unified API Gateway and Model Library

**Goal:** Extract model management and provider/protocol calling into an upper runtime library so the app can support many model providers while keeping the current Anthropic-compatible execution contract stable.

**MVP Shape:** Introduce a model registry and gateway adapter boundary without changing the frontend model configuration UX drastically. DeepSeek Anthropic-compatible models continue to work. Future Kimi, Minimax, Anthropic, OpenAI-compatible, and local providers can be added by adapter rather than patching `AgentExecutor`.

**Files:**
- Modify: `server/modelConfig.js`
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server/agent/messageBuilder.js`
- Create: `server/model/modelRegistry.js`
- Create: `server/model/modelRegistry.test.js`
- Create: `server/model/providerGateway.js`
- Create: `server/model/providerGateway.test.js`
- Create: `server/model/protocols/anthropicMessages.js`
- Create: `server/model/protocols/anthropicMessages.test.js`
- Modify: `src/lib/modelContext.js`
- Modify: model-management UI files under `src/pages/PromptLabPage.jsx` or a new focused component

**Interfaces:**
- Produces: `loadModelRegistry(): ModelRegistry`.
- Produces: `resolveModelProfile(modelId): { id, provider, protocol, endpoint, contextWindow, cacheSemantics, capabilities }`.
- Produces: `callModelGateway({ modelProfile, request, stream, signal }): AsyncIterable<ModelRuntimeEvent>`.
- Consumes: current `MODELS_CONFIG` and model records with `contextWindow`.

- [ ] **Step 1: Write registry compatibility tests**

Cover legacy `MODELS_CONFIG` parsing, pretty JSON config parsing, default `contextWindow: 128000`, DeepSeek provider inference, and preserving existing fields.

- [ ] **Step 2: Implement model registry module**

Move model config parsing and normalization into `server/model/modelRegistry.js`. Keep `server/modelConfig.js` as a thin compatibility wrapper until routes are extracted.

- [ ] **Step 3: Write gateway adapter tests**

Cover Anthropic-compatible request alignment, DeepSeek thinking parameter rules, provider-specific cache usage normalization, and stream event normalization.

- [ ] **Step 4: Implement Anthropic Messages protocol adapter**

Move request-body alignment, headers, endpoint construction, and stream parsing boundary out of `AgentExecutor` into `server/model/protocols/anthropicMessages.js`.

- [ ] **Step 5: Rewire `AgentExecutor` to gateway**

`AgentExecutor` should request a normalized stream of runtime events from the gateway and keep its ReAct loop responsibilities: message mutation, hooks, tool execution, and persistence.

- [ ] **Step 6: Update model UI labels and validation**

Keep add/edit model flow simple, but show protocol/provider/context-window as first-class fields. Avoid forcing protocol choice when provider inference is enough; let advanced users override.

- [ ] **Step 7: Verify**

Run:

```bash
node --test server/model/modelRegistry.test.js server/model/providerGateway.test.js server/model/protocols/anthropicMessages.test.js
node --test server/agent/AgentExecutor.stream.test.js server/agent/usageNormalizer.test.js
npm test
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add server/model server/modelConfig.js server/agent/AgentExecutor.js server/agent/messageBuilder.js src
git commit -m "refactor: add unified model gateway"
```

### Task 8: Mountable External Knowledge Bases

**Goal:** Let users upload files, generate reusable knowledge bases, and mount selected knowledge bases into a conversation as external context without hard-wiring them into every prompt.

**MVP Shape:** Start with local “knowledge packs”: uploaded files are extracted to clean text/markdown chunks, stored with metadata, and exposed as a mountable resource similar to a skill/reference bundle. Retrieval can begin as keyword/metadata search before adding vector RAG.

**Files:**
- Create: `server/knowledge/knowledgeStore.js`
- Create: `server/knowledge/knowledgeStore.test.js`
- Create: `server/knowledge/knowledgeIngest.js`
- Create: `server/knowledge/knowledgeIngest.test.js`
- Create: `server/knowledge/knowledgeRetrieve.js`
- Create: `server/knowledge/knowledgeRetrieve.test.js`
- Modify: `server/agent/plugins/SkillsPlugin.js` or add `server/agent/plugins/KnowledgePlugin.js`
- Modify: `server.js` or future extracted knowledge routes
- Create: `src/lib/knowledgeMounts.js`
- Create: `src/lib/knowledgeMounts.test.js`
- Modify: Prompt Lab or trajectory configuration UI to upload/select mounted knowledge bases

**Interfaces:**
- Produces: `createKnowledgeBase({ name, description, files })`.
- Produces: `ingestKnowledgeFile({ knowledgeBaseId, filename, mimeType, content })`.
- Produces: `retrieveKnowledge({ knowledgeBaseIds, query, limit }): KnowledgeChunk[]`.
- Produces: `mountKnowledgeBases({ harnessId, knowledgeBaseIds })`.
- Consumes: selected harness/session configuration and runtime pre-LLM injection.

- [ ] **Step 1: Write knowledge store tests**

Cover creating a knowledge base, listing bases, deleting a base, adding file metadata, and path-safe storage under a dedicated workspace directory.

- [ ] **Step 2: Implement local knowledge store**

Persist metadata and chunks under `server/knowledge-data/` or an equivalent gitignored runtime directory. IDs must be slug-safe and collision checked.

- [ ] **Step 3: Write ingestion tests**

Cover plain text, markdown, JSON, and unsupported file type rejection. The MVP should not parse PDFs unless a dedicated parser is added in a later batch.

- [ ] **Step 4: Implement text/markdown ingestion**

Normalize uploaded content to markdown-ish text, split into bounded chunks, store chunk metadata, and keep original file metadata for traceability.

- [ ] **Step 5: Write retrieval tests**

Cover keyword retrieval, mounted-base filtering, result limits, and stable source citations.

- [ ] **Step 6: Implement retrieval and runtime mount**

Add a plugin that retrieves top chunks for the current user turn and injects a bounded `<mounted_knowledge>` block. Include source labels and avoid injecting entire files.

- [ ] **Step 7: Add upload/select UI**

Add a lightweight knowledge panel with upload, list, mount/unmount, and current mounted knowledge indicators. Keep large file contents out of the main trajectory.

- [ ] **Step 8: Verify**

Run:

```bash
node --test server/knowledge/knowledgeStore.test.js server/knowledge/knowledgeIngest.test.js server/knowledge/knowledgeRetrieve.test.js
node --test src/lib/knowledgeMounts.test.js
npm test
npm run build
```

- [ ] **Step 9: Commit**

```bash
git add server/knowledge server/agent/plugins server.js src
git commit -m "feat: add mountable knowledge bases"
```

## Active Acceptance Criteria

- `docs/superpowers/plans/` contains only this active roadmap unless a new concrete implementation batch is intentionally split out.
- Completed historical plans live under `docs/superpowers/plans/archive/`.
- `npm test` passes before merging a runtime-roadmap batch.
- `npm run build` passes before merging a frontend-impacting batch.
- Any future plan split must state why it cannot be tracked as a task in this consolidated roadmap.
- Memory writes, model provider calls, and knowledge mounts each have a visible runtime boundary and can be independently disabled for experiments.

## Notes

- This roadmap intentionally does not reintroduce child-agent turn limits. The current direction is to remove arbitrary child turn caps and rely on runtime contracts, observability, permission flow, and cancellation semantics.
- This roadmap treats `sub_agent` and `agent_teams` as harness-profile compositions over shared child-agent primitives.
- Commercial-style strategy presets can be added later, but the experimental platform must keep primitives independently toggleable.
- Candidate memories should be reviewed before becoming durable memory by default; direct auto-write is an advanced experimental mode.
- The unified model gateway should separate provider identity from wire protocol. A DeepSeek model can still use the Anthropic-compatible protocol.
- Knowledge bases should first behave like mountable skill/reference resources; vector RAG is an optimization layer, not the initial architecture requirement.
