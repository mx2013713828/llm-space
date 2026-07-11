# Runtime Roadmap Consolidated Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` when implementing a concrete task from this roadmap. Every implementation batch must add regression tests before code changes and end in a small commit.

**Goal:** Move LLM Space from a collection of useful experimental features into a coherent runtime harness. The central design principle is:

> **Many mechanisms, one loop.**

Tools, permissions, memory, skills, compaction, cron, background work, teams, model gateways, and knowledge bases should all attach to explicit stages of the same agent loop instead of growing as separate side paths.

**Current tech stack:** Node.js ES modules, Express SSE, `AgentExecutor` / `HookManager` plugins, React 19, Vite, Node test runner, Anthropic-compatible model calls with DeepSeek compatibility, local filesystem-backed stores for sessions, teams, memory, scheduler data, and future knowledge packs.

---

## Architecture Spine

The target runtime is not a new agent brain. It is a clearer harness around the same ReAct loop:

```text
user input
  -> inbound request / session envelope
  -> runtime notifications
  -> pre-LLM context assembly
  -> model gateway
  -> normalized model events
  -> tool-use detection
      no tool_use -> stop hooks -> persist -> return
      tool_use    -> pre-tool hooks + permission
                -> tool pool dispatch
                -> post-tool hooks
                -> tool_result messages
                -> next loop
```

Each runtime mechanism must declare which stage it belongs to:

| Loop Stage | Runtime Boundary | Examples |
| --- | --- | --- |
| Inbound request | HTTP routes, access guard, active job reservation | `/api/agent/run`, local API guard, session lookup |
| Runtime notifications | bounded queue injected before LLM | cron fired, teammate inbox, background result, permission state |
| Pre-LLM assembly | context builders and resource mounts | system metadata, memory, skills catalog, knowledge retrieval, strategy guideline |
| Model gateway | provider and protocol adapters | DeepSeek Anthropic-compatible, future Kimi, Minimax, OpenAI-compatible |
| Stream normalization | provider event parser | thinking, text, tool_use, usage, stop reason |
| Tool-use detection | normalized assistant blocks | actual `tool_use` blocks, text-encoded fallback handling |
| Permission and policy | pre-tool hooks | sensitive files, bash sandbox, external writes, approval bridge |
| Tool pool dispatch | assembled runtime tools | built-in tools, task tools, team tools, MCP tools |
| Post-tool processing | output shaping and persistence | redaction, offloading, child trace preview, large output metadata |
| Stop / cleanup | lifecycle hooks | memory candidate extraction, task release, session persistence |

---

## Design Rules

- Keep the project experimental and modular. Presets may exist, but primitives must remain independently toggleable.
- Do not fix runtime correctness only by prompt edits, hidden retries, max-turn increases, or UI suppression.
- Separate provider identity from wire protocol. A DeepSeek model can use the Anthropic-compatible protocol.
- Treat skills, memory, knowledge bases, MCP tools, and model access as mountable runtime resources.
- Keep main trajectory rendering bounded. Full child traces, teammate reports, and large tool outputs must be lazy-loaded.
- Prefer shared child-agent primitives over one-off `sub_agent` and `teammate` forks.
- Prefer explicit runtime contracts over implicit convention. If a component mutates messages, injects context, consumes inbox, or persists state, that boundary needs tests.
- Any task split out of this roadmap must explain why it cannot be tracked here.

---

## Current Baseline

Completed and tested capabilities:

- Runtime trace-inspection mode can disable tools for questions about previous tool calls.
- Tool invocation validation marks malformed calls as typed `invalid_args` before execution.
- Teammate/sub-agent final outcome handling rejects tool-only output as `no_result`.
- Frontend run view model separates live stream state from persisted session snapshots.
- Memory injection and extraction are disabled for trace-inspection turns.
- Sub-agent and teammate cards share child status presentation, permission-wait visibility, and lazy trace loading.
- Child-agent profiles share feature/tool filtering, scratch workspace policy, and unbounded child run semantics.
- `read_file` and `write_file` enforce workspace path policy and sensitive-file denial.
- Bash foreground and background execution share a macOS sandbox boundary plus sensitive-output redaction.
- Permanent sensitive-file security blocks stop the agent loop after one blocked attempt.
- Harness creation has collision checks.
- Legacy `/api/chat` is disabled with `410`.
- Frontend API calls go through a central API boundary.
- React Error Boundary protects the app from full white-screen crashes.
- Local runtime APIs have a localhost/token access guard and lightweight rate limits.
- `npm test` and `npm run build` passed for the latest completed runtime batch.

Completed implementation records remain archived under `docs/superpowers/plans/archive/`.

---

## Roadmap Overview

The remaining work is organized by architecture layer, not by isolated feature.

```text
Stage 1: Runtime shell and server boundaries
Stage 2: Agent loop kernel, tool pool, and notifications
Stage 3: Model gateway and stream normalization
Stage 4: Collaboration runtime: teams, protocols, worktrees
Stage 5: Context & RAG knowledge layer: guidance, memory, prompt assembly, local Knowledge Bases
Stage 6: MCP runtime layer: standalone MCP client, tool adaptation, permission UX
Stage 7: Unified runtime resource layer: resource mount registry and experiment profiles
Stage 8: Runtime quality: tests, observability, E2E, maintainability
```

Current closure point: **Stage 1 through Stage 5 Task 15 plus Knowledge Runtime Strategies are minimally closed and tested**. Task 9, Task 10, and Task 14 remain intentionally deferred because protocol approval, worktree isolation, and multi-layer guidance composition are heavier follow-up features.

The recommended next task is **Task 16: RAG Retrieval Quality Extensions**. Task 11 through Task 13 closed the first Stage 5 foundations: automatic memory quality gating, `AGENTS.md` explicit guidance, and the static Context Assembly Inspector. Task 15 now provides a local Knowledge Base MVP with create/import/index/retrieve/mount flow, and Knowledge Runtime Strategies add Auto RAG, Agentic RAG, Manual Lab, split manifest/retrieval context, and agent-controlled knowledge tools.

---

## Stage 1: Runtime Shell And Server Boundaries

### Task 1: Runtime Shell And Server Boundary Split

**Goal:** Reduce `server.js` blast radius and make runtime entry points testable without changing behavior.

**Why now:** The server currently owns HTTP routing, model config, active jobs, session persistence, scheduler APIs, and agent startup in one file. Future kernel work needs a clean request boundary first.

**Loop stage:** Inbound request.

**Files:**

- Modify: `server.js`
- Create: `server/app/createServerApp.js`
- Create: `server/routes/harnessRoutes.js`
- Create: `server/routes/modelRoutes.js`
- Create: `server/routes/sessionRoutes.js`
- Create: `server/routes/agentRunRoutes.js`
- Create: `server/agent/activeJobs.js`
- Test: `server/routes/*test.js`
- Test: `server/agent/activeJobs.test.js`

**Interfaces:**

- `createServerApp(dependencies): express.Application`
- `registerHarnessRoutes(app, dependencies)`
- `registerModelRoutes(app, dependencies)`
- `registerSessionRoutes(app, dependencies)`
- `registerAgentRunRoutes(app, dependencies)`
- `createActiveJobRegistry(): { reserve, attach, release, get, list }`

**Steps:**

- [x] Write behavior-preserving route tests for harness load/save/copy/delete, model list/upsert/update, session read/write/delete, and legacy chat `410`.
- [x] Extract active job reservation into `activeJobs.js` with tests for reserve-before-await, attach, release, and concurrent duplicate runs.
- [x] Extract one route group at a time from `server.js`; do not mix behavior changes into the extraction.
- [x] Move app assembly into `createServerApp`, leaving `server.js` as bootstrapping, `.env` loading, scheduler startup, and `listen`.
- [x] Verify with `npm test` and `npm run build`.
- [x] Commit with `refactor: split runtime server boundaries`.

### Task 2: Runtime Request Contract

**Goal:** Make `/api/agent/run` input validation, feature normalization, selected strategy resolution, and session persistence explicit before the executor is created.

**Why:** We currently rebuild an executor per user turn. That can remain true, but the request contract must be clear so model gateway, notifications, memory, teams, and tool pool assembly do not each reinterpret the request.

**Loop stage:** Inbound request.

**Files:**

- Create: `server/agent/runtimeRequest.js`
- Create: `server/agent/runtimeRequest.test.js`
- Modify: `server/routes/agentRunRoutes.js`
- Modify: `server/agent/AgentExecutor.js`
- Reuse: `server/sessions/sessionState.js`

**Interfaces:**

- `buildRuntimeRequest({ body, harness, persistedSession, models }): RuntimeRequest`
- `resolveRuntimeFeatures(rawFeatures): RuntimeFeatures`
- `resolveRuntimeStrategy({ explicitStrategyId, features }): string`

**Steps:**

- [x] Write tests for missing harness id, invalid harness id, selected model lookup, feature defaulting, strategy fallback, team context restoration, and scheduled run payloads.
- [x] Implement `RuntimeRequest` as a plain serializable object passed into executor construction.
- [x] Keep existing API response shapes unchanged.
- [x] Reuse `buildPersistedSessionState` from executor save path so runtime persistence follows the shared session contract.
- [x] Verify with targeted tests, `npm test`, and `npm run build`.
- [x] Commit with `refactor: add runtime request contract`.

---

## Stage 2: Agent Loop Kernel, Tool Pool, And Notifications

### Task 3: Agent Loop Stage Contract

**Goal:** Make `AgentExecutor` easier to reason about by naming and testing the loop stages without rewriting the whole executor at once.

**Why:** S20's key lesson is that the loop stays simple, while mechanisms attach around it. We need tests that prove where hooks, compaction, model calls, tool execution, and stop cleanup happen.

**Loop stage:** Whole loop.

**Files:**

- Modify: `server/agent/AgentExecutor.js`
- Create: `server/agent/agentLoopStages.js`
- Create: `server/agent/agentLoopStages.test.js`
- No change needed: `server/agent/HookManager.js`
- Test: `server/agent/AgentExecutor.run.test.js`

**Interfaces:**

- `runPreLlmStage(context)`
- `runModelStage(context)`
- `runToolStage(context)`
- `runStopStage(context)`
- `hasExecutableToolUse(blocks)`

**Steps:**

- [x] Add tests that assert actual `tool_use` blocks drive continuation, not only provider `stop_reason`.
- [x] Add tests for cleanup on normal final answer, error, security block, and permission wait.
- [x] Extract small stage helpers only where tests already cover behavior.
- [x] Keep public stream events and persisted message shapes unchanged.
- [x] Verify with targeted tests, `npm test`, and `npm run build`.
- [x] Commit with `refactor: define agent loop stage contract`.

### Task 4: Tool Pool Assembly Boundary

**Goal:** Centralize tool selection for lead agents, sub-agents, teammates, task modes, strategy presets, future MCP tools, and future knowledge tools.

**Why:** Tool availability is currently spread across feature schema, orchestration helpers, child profiles, and plugins. That makes teams and sub-agents hard to reason about.

**Loop stage:** Tool pool dispatch.

**Files:**

- Create: `server/agent/toolPool.js`
- Create: `server/agent/toolPool.test.js`
- Modify: `server/tools/index.js`
- Modify: `server/agent/child/childAgentProfile.js`
- Modify: `server/agent/subAgentProfile.js`
- Modify: `server/agent/teams/teammateProfile.js`
- Modify: `server/routes/harnessRoutes.js`
- Modify: `src/components/ContextInspector.jsx`

**Interfaces:**

- `assembleToolPool({ baseTools, features, runtimeRole, strategyId, mountedResources }): ToolPool`
- `filterToolsForRuntimeRole(toolPool, runtimeRole)`
- `describeToolPool(toolPool): ToolPoolSummary`

**Steps:**

- [x] Write tests for lead, sub-agent, teammate, reviewer, verifier, task-system mode, todo mode, async teams, and orchestration-disabled cases.
- [x] Move managed orchestration tool filtering into the server-side boundary.
- [x] Keep frontend feature UI as configuration, not the source of truth for runtime tools.
- [x] Add a compact tool-pool summary for Context Inspector.
- [x] Verify with targeted tests, `npm test`, and `npm run build`.
- [x] Commit with `refactor: centralize runtime tool pool assembly`.

### Task 5: Runtime Notification Queue

**Goal:** Unify asynchronous signals before they reach the model: cron triggers, background task results, teammate inbox messages, permission state, memory candidates, and future knowledge ingest results.

**Why:** We have repeatedly seen message-tree pollution, duplicated injection, and confusing UI around asynchronous outputs. A bounded notification queue gives each source one path into the loop.

**Loop stage:** Runtime notifications before LLM.

**Files:**

- Create: `server/agent/runtimeNotifications.js`
- Create: `server/agent/runtimeNotifications.test.js`
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server/agent/plugins/TeamPlugin.js`
- Modify: `server/agent/scheduler/cronRunner.js`
- Modify: background task integration points if present.
- Modify: `server/routes/harnessRoutes.js`
- Modify: `src/components/ContextInspector.jsx`

**Interfaces:**

- `enqueueRuntimeNotification({ harnessId, source, type, payload, priority })`
- `drainRuntimeNotifications({ harnessId, limit }): RuntimeNotification[]`
- `formatNotificationsForLlm(notifications): MessageBlock[]`
- `summarizeNotificationsForUi(notifications): NotificationSummary`

**Steps:**

- [x] Write tests for bounded injection, dedupe, source labels, unread counts, and non-consuming previews.
- [x] Move team inbox auto-injection behind the notification queue.
- [x] Move scheduled prompt injection behind the same queue without changing scheduler behavior.
- [x] Route legacy background pending notifications through the runtime queue while preserving UI history.
- [x] Expose notification summaries to Context Inspector.
- [x] Verify with targeted tests, `npm test`, and `npm run build`.
- [x] Commit with `feat: add runtime notification queue`.

---

## Stage 3: Model Gateway And Stream Normalization

### Task 6: Shared Streaming Parser

**Goal:** Remove Anthropic-compatible SSE parsing from `AgentExecutor` and normalize provider stream chunks into provider-neutral runtime events.

**Why:** DeepSeek/Anthropic-compatible behavior, thinking blocks, text deltas, tool calls, usage, and stop reasons should be fixtures in parser tests, not hidden inside `AgentExecutor`. Pi-style stream normalization also gives the future model gateway one stable event contract before adding OpenAI-compatible or native adapters.

**Loop stage:** Stream normalization.

**Files:**

- Modify: `server/agent/AgentExecutor.js`
- Create: `server/model/streamParser.js`
- Create: `server/model/streamParser.test.js`
- Test: `server/agent/AgentExecutor.stream.test.js`

**Interfaces:**

- `parseProviderSseLines(lines): RawProviderEvent[]`
- `normalizeAnthropicCompatibleEvent(event): ModelRuntimeEvent[]`
- `createAnthropicCompatibleStreamState(): { blocksByIndex: Map<number, StreamBlockState> }`

**Runtime event contract:**

- `message_start`: normalized model and raw usage.
- `thinking_start`, `thinking_delta`, `thinking_end`: addressed by `index` and stable assistant message id.
- `text_start`, `text_delta`, `text_end`: addressed by `index` and stable assistant message id.
- `tool_start`, `tool_input_delta`, `tool_end`: addressed by `index` and provider tool id.
- `message_delta`: normalized stop reason and raw usage.
- `provider_error`: normalized provider-side stream errors.

**Boundary:** Task 6 does not choose protocols, build request bodies, move model config, or add OpenAI-compatible calls. It only prepares the stream event contract that Task 7 will consume.

**Steps:**

- [x] Write parser fixture tests for thinking, text, tool_use, malformed JSON lines, message_delta stop reasons, usage, and interleaved content indexes.
- [x] Implement parser and Anthropic-compatible normalizer without changing public UI stream events.
- [x] Rewire `AgentExecutor._callLLM` to consume normalized runtime events through a per-index block state map.
- [x] Verify and commit with `refactor: extract model stream parser`.

### Task 7: Unified Model Gateway And Model Library

**Goal:** Extract model management and provider/protocol calling into an upper runtime library while keeping the current Anthropic-compatible execution contract stable.

**Why:** The project only supports Anthropic-style messages today, but model providers are already diverse. Provider identity and wire protocol must be independent: the same provider can expose one model connection through `protocol: "anthropic"` and another through `protocol: "openai"`.

**Loop stage:** Model gateway.

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
- Modify: model UI files under `src`.

**Interfaces:**

- `loadModelRegistry(): ModelRegistry`
- `resolveModelProfile(modelId): { id, provider, protocol, baseUrl, modelId, contextWindow, cacheSemantics, capabilities }`
- `callModelGateway({ modelProfile, request, stream, signal }): AsyncIterable<ModelRuntimeEvent>`

**Model connection contract:**

- `provider`: supplier identity for display, defaults, and provider-specific compatibility hints.
- `protocol`: wire adapter selector, initially `anthropic` and later `openai` or native adapters.
- `baseUrl`: concrete endpoint root for the selected protocol.
- `modelId`: provider API model name.
- `contextWindow`: explicit model context window, defaulting to `128000` for legacy configs.
- `capabilities`: model-level feature hints such as tools, thinking, prompt cache, and cache write support.

**Steps:**

- [x] Write registry compatibility tests for legacy `MODELS_CONFIG`, pretty JSON config, default `contextWindow: 128000`, DeepSeek provider inference, and existing fields.
- [x] Implement model registry and keep `server/modelConfig.js` as a compatibility wrapper until route extraction is complete.
- [x] Write gateway tests for `protocol: "anthropic"` request alignment, DeepSeek thinking rules, cache usage normalization, and stream normalization.
- [x] Move request-body alignment, headers, endpoint construction, and protocol details into `anthropicMessages.js`.
- [x] Add an OpenAI-compatible adapter only after Anthropic-compatible behavior is stable behind the gateway.
- [x] Rewire `AgentExecutor` to request normalized events from the gateway.
- [x] Update model UI so provider, protocol, context window, and cache semantics are visible but not heavy.
- [x] Verify and commit with `refactor: add unified model gateway`.

---

## Stage 4: Collaboration Runtime

### Task 8: Teams v2 Observability And Result Reliability

**Goal:** Make Async Teams reliable enough for everyday experiments without hiding the underlying primitives.

**Why:** We fixed several teammate output and frontend rendering problems, but teams still need stronger lifecycle semantics and clearer lead-facing instructions.

**Loop stages:** Tool pool dispatch, runtime notifications, post-tool processing.

**Files:**

- Modify: `server/agent/plugins/TeamPlugin.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `src/components/MessageBubbles.jsx`
- Modify: `src/lib/childStatusPresentation.js`
- Test: `server/agent/plugins/TeamPlugin.test.js`
- Test: `server/agent/teams/teammateRunner.test.js`
- Test: `src/lib/childStatusPresentation.test.js`

**Interfaces:**

- Lifecycle states: `running`, `awaiting_permission`, `completed`, `failed`, `no_result`, `cancelled`.
- Lead actions: wait, check inbox, request resend, summarize partial results, cancel.

**Implementation note:** Completed in the Teams v2 reliability batch. `wait_for_teammates` is status-only and preserves inbox contents; teammate reports flow through `check_team_inbox` or lazy trace references. Teammate result/error inbox payloads include `traceRef` so the lead can locate the full trace when a report is truncated, no-result, or needs audit.

**Steps:**

- [x] Add observability tests for spawn cards, wait cards, no-result inbox, permission waits, and lazy trace references.
- [x] Ensure `wait_for_teammates` returns state and unread counts, never large reports.
- [x] Ensure final report data flows through inbox or trace store, not wait output.
- [x] Improve lead-facing text so the model knows when to call `check_team_inbox`.
- [x] Verify and commit with `feat: improve teams v2 observability`.

### Task 9: Team Protocols MVP

> **Status:** Deferred. This is useful for safer multi-agent coding, but it is heavier than the current experimental-platform closure target. Resume after Stage 5 resource mounting is usable or when teams start doing substantial code-changing work.

**Goal:** Add an optional plan/review/approval protocol for teammate work before code-changing tasks begin.

**Why:** Teams become safer when teammates can submit a plan, pause for approval, and only then claim work. This is especially important once worktree isolation and write tools are enabled.

**Loop stages:** Tool pool dispatch, runtime notifications, permission and policy.

**Files:**

- Modify: `server/agent/plugins/TeamPlugin.js`
- Create: `server/agent/teams/teamProtocol.js`
- Create: `server/agent/teams/teamProtocol.test.js`
- Modify: `server/agent/teams/teamStore.js`
- Modify: UI child/team status components.

**Interfaces:**

- `submit_team_plan({ summary, steps, risks })`
- `approve_team_plan({ teammate, planId })`
- `reject_team_plan({ teammate, planId, reason })`
- Future: `request_team_review`, `cancel_teammate`

**Steps:**

- [ ] Write protocol state tests for submitted, approved, rejected, and stale plans.
- [ ] Add protocol tools only when team protocol is enabled.
- [ ] Represent plan approval as a permission-like state in the parent UI.
- [ ] Keep protocol optional so simple teams can still run directly.
- [ ] Verify and commit with `feat: add team plan protocol`.

### Task 10: Worktree-Isolated Team Execution

> **Status:** Deferred. This should wait until team protocols and child-agent write workflows need true parallel code modification. Current teams are considered minimally closed after Task 8.

**Goal:** Let teammates and complex sub-agents work in isolated git worktrees for code-changing tasks.

**Why:** For real multi-agent coding, isolation is more important than more prompting. Worktree isolation lets the lead review and merge child work instead of letting multiple agents mutate one workspace.

**Loop stages:** Tool pool dispatch, permission and policy, post-tool processing.

**Files:**

- Create: `server/agent/worktrees/worktreeStore.js`
- Create: `server/agent/worktrees/worktreeStore.test.js`
- Create: `server/tools/worktreeTools.js`
- Create: `server/tools/worktreeTools.test.js`
- Modify: child-agent profile creation.
- Modify: team protocol and task claim flow.

**Interfaces:**

- `createWorktree({ harnessId, taskId, name })`
- `assignWorktreeToChild({ childId, worktreeId })`
- `summarizeWorktreeDiff({ worktreeId })`
- `keepWorktree` / `removeWorktree`

**Steps:**

- [ ] Write storage and path-safety tests.
- [ ] Add create/list/remove worktree primitives behind an experimental feature flag.
- [ ] Route child bash/read/write default cwd through assigned worktree.
- [ ] Add lead-facing diff summary before merge or cleanup.
- [ ] Verify and commit with `feat: add worktree-isolated child execution`.

---

## Stage 5: Context & Knowledge Layer

Stage 5 now treats prompt guidance, memory, knowledge, and future mounted resources as separate context layers. The key product rule is: Context Inspector shows what is sent to the model; runtime queues and sidecar state belong in their own observability surfaces unless they are actually injected into the model request.

### Task 11: Automatic Memory Quality Gate

**Goal:** Improve the automatic memory module so extracted memories are classified, observable, and routed safely without turning memory into a heavy approval workflow.

**Why:** Memory is a runtime resource. Automatic capture should stay smooth, but it must not silently turn teammate reports, temporary task state, sensitive data, or low-confidence guesses into durable long-term memory.

**Loop stages:** Stop / cleanup, pre-LLM assembly.

**Files:**

- Modify: `server/agent/plugins/MemoryPlugin.js`
- Modify: `server/agent/memory/memoryExtract.js`
- Create: `server/agent/memory/memoryQualityGate.js`
- Create: `server/agent/memory/memoryQualityGate.test.js`
- Create: `server/agent/memory/memoryCandidateStore.js`
- Create: `server/agent/memory/memoryCandidateStore.test.js`
- Create: `server/agent/memory/memoryCandidateApi.test.js`
- Modify: memory routes.
- Add lightweight memory candidate visibility; do not add interruptive approval prompts in the main chat.
- Create: `src/lib/memoryCandidates.test.js`

**Interfaces:**

- `classifyMemoryItem(item, context): { decision, reason, confidence, risk }`
- `createMemoryCandidate({ harnessId, item, source, reason, confidence, risk })`
- `listMemoryCandidates({ harnessId, status })`
- `approveMemoryCandidate({ harnessId, candidateId, patch })`
- `rejectMemoryCandidate({ harnessId, candidateId, reason })`

**Implementation note:** MVP completed as an automatic memory quality gate, not a heavy approval workflow. Auto-capture now routes extracted memories through deterministic decisions: `auto_write`, `pending_review`, `discard`, and `sensitive_blocked`. Pending candidates are stored in a background queue and surfaced through bounded API / Context Inspector summaries. A full review UI is intentionally deferred until the candidate behavior has been tested in real use.

**Steps:**

- [x] Write quality-gate tests for `auto_write`, `pending_review`, `discard`, and `sensitive_blocked`.
- [x] Implement classification rules that auto-write explicit user memory and stable preferences, discard transient/runtime outputs, block secrets, and queue ambiguous but useful items.
- [x] Write candidate store tests for creation, listing, approval, rejection, persistence, and path safety.
- [x] Implement filesystem-backed candidate storage with `pending`, `approved`, and `rejected` states.
- [x] Rewire extraction so `auto_write` continues to write long-term memory, `pending_review` creates candidates, and `discard` / `sensitive_blocked` do not write.
- [x] Add review API and lightweight candidate visibility without interruptive prompts.
- [x] Verify and commit with `feat: add automatic memory quality gate`.

### Task 12: AGENTS.md Explicit Guidance

**Goal:** Move editable base agent instructions out of harness JSON and into `guidance/<harnessId>/AGENTS.md`.

**Why:** Explicit guidance should be directly editable, file-backed, and separate from structured harness runtime configuration.

**Status:** Completed.

**Implementation note:** The harness API still transports the editable guidance as `systemPrompt` for compatibility, but load/save now hydrates from and persists to `guidance/<harnessId>/AGENTS.md`. Legacy `harnesses/*.json.systemPrompt` is used only as fallback initialization.

### Task 13: Pinned Strategy + Context Assembly Inspector

**Goal:** Make Context Inspector a fast, clear view of exactly what the current model request receives.

**Why:** The current inspector mixes model context with runtime dashboard state. It also dynamically injects the full active strategy guideline into the latest user turn, which is less cache-friendly and harder to reason about.

**Loop stages:** Pre-LLM assembly, static dry-run inspection.

**Status:** Completed.

**Implementation note:** Context Inspector now uses static dry-run mode, does not call LLM for memory side-query, and defaults to a split assembly view over only the model-bound payload: system prompt sections, messages, and provider tool schema. Active execution strategy is pinned into the system prompt instead of appended to the latest user turn.

**Files:**

- Create: `server/agent/promptAssembly/promptAssembly.js`
- Create: `server/agent/promptAssembly/promptAssembly.test.js`
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server/agent/runtimeContext.js`
- Modify: `server/agent/plugins/ExecutionStrategyPlugin.js`
- Modify: `server/agent/plugins/MemoryPlugin.js`
- Modify: `server/agent/plugins/SkillsPlugin.js`
- Modify: `server/agent/plugins/TaskSystemPlugin.js`
- Modify: `server/agent/plugins/TodoNagPlugin.js`
- Modify: `server/routes/harnessRoutes.js`
- Create: `src/lib/contextInspectorModel.js`
- Create: `src/lib/contextInspectorModel.test.js`
- Modify: `src/components/ContextInspector.jsx`

**Interfaces:**

- `createPromptSection({ id, label, target, lifecycle, source, content, order, sentToModel, cacheImpact, metadata })`
- `appendSystemPromptSection(context, section)`
- `summarizePromptAssembly(sections)`
- `dryRunMode: 'static_context'`
- `promptAssembly: { sections, totals }`

**Steps:**

- [x] Add prompt assembly section helpers and base AGENTS.md/runtime context tracking.
- [x] Pin `<active_execution_strategy>` into system prompt and remove it from latest user turn.
- [x] Add static Context Inspector dry-run mode that does not call LLM and skips concrete memory side-query.
- [x] Return `promptAssembly.sections` from dry-run and remove runtime tool pool / notification / memory candidate summaries from default inspector response.
- [x] Replace Context Inspector with a split assembly UI showing System Prompt, Messages Payload, and Provider Tool Schema only.
- [x] Verify and commit with `feat: add context assembly inspector`.

### Task 14: Multi-layer Guidance Composition

**Goal:** Add project-level guidance composition on top of harness-level `AGENTS.md`.

**Why:** Explicit Guidance should support reusable project instructions without forcing every harness to duplicate the same rules.

**Loop stages:** Pre-LLM assembly, harness configuration.

**Files:**

- Modify: `server/agent/guidance/agentGuidance.js`
- Modify: `server/agent/guidance/agentGuidance.test.js`
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/routes/harnessRoutes.test.js`
- Modify: `src/components/ConfigPanel.jsx`
- Modify: `src/pages/PromptLabPage.jsx`
- Modify: `src/components/ContextInspector.jsx`

**Interfaces:**

- `loadGuidanceLayers({ harnessId }): GuidanceLayer[]`
- `saveHarnessGuidance({ harnessId, content })`
- `guidance/project/AGENTS.md`
- `guidance/<harnessId>/AGENTS.md`

**Steps:**

- [ ] Add project-level `guidance/project/AGENTS.md` loading before harness-level guidance.
- [ ] Keep harness-level guidance editable through the existing AGENTS.md editor.
- [ ] Show both guidance layers in Context Inspector prompt assembly.
- [ ] Add tests proving composition order is project guidance then harness guidance.
- [ ] Verify and commit with `feat: compose multi-layer guidance`.

### Task 15: Local RAG Knowledge Base MVP

**Goal:** Let users create local Knowledge Bases from selected files, generate a lightweight RAG database, test retrieval, and mount selected bases into conversations as bounded, source-labeled context.

**Status:** MVP plus runtime strategy layer implemented. The first closure supports local metadata storage, Markdown/text/JSON parsing, bounded chunking, keyword indexing, retrieval preview, harness-level mounting, Auto RAG, Agentic RAG, Manual Lab, pinned Mounted Knowledge Manifest, per-turn Retrieved Knowledge, and agent-controlled list/query knowledge tools. Embedding providers, richer file parsers, vector/hybrid retrieval, rerank, and retrieval evaluation remain follow-up work.

**Why:** Dify's knowledge workflow shows that RAG should be a visible data pipeline, not a hidden "upload to vector DB" button. LLM-Space should start with a lightweight local MVP while preserving the final architecture for multiple file types, configurable embedding providers, hybrid retrieval, rerank, and parent-child retrieval.

**Loop stages:** Knowledge management, pre-LLM assembly, Context Inspector dry-run.

**MVP scope:**

- Users can create, list, rename, delete, and inspect local Knowledge Bases.
- Users can import `.md`, `.txt`, and `.json` files in the first version.
- Document parsing is routed through a small parser adapter interface, even though the MVP only ships three parsers.
- Each upload can optionally override basic processing settings such as parser type, cleanup, chunk size, overlap, and retrieval limits.
- Ingestion performs deterministic text extraction, cleanup, chunking, and local keyword/BM25-ish indexing.
- Users can preview chunks before final ingestion or inspect chunks after ingestion.
- Users can run retrieval tests against a Knowledge Base without starting an agent loop.
- Ingestion and retrieval expose lightweight pipeline progress: parse, clean, chunk, index, retrieve, inject.
- Users can mount one or more Knowledge Bases to a harness/conversation.
- `KnowledgePlugin` supports three runtime strategies: Auto RAG, Agentic RAG, and Manual Lab.
- Mounted Knowledge Manifest is pinned as stable system context when strategy requires it.
- Retrieved Knowledge is injected into the latest user turn only when matching chunks exist.
- Agentic RAG exposes `list_mounted_knowledge_bases` and `query_knowledge_base` through the runtime tool pool.
- Context Inspector separates System Prompt, Mounted Knowledge Manifest, Retrieved Knowledge, Messages Payload, and Provider Tool Schema.

**Final RAG direction:**

- Support more file types: PDF, DOCX, PPTX, CSV/TSV, HTML, code files, and eventually images/OCR when the extraction layer is ready.
- Keep document parsers as independent adapters so extraction, chunking, indexing, and retrieval can evolve separately.
- Support per-upload process config so a user can experiment with parser, chunking, summary, question generation, embedding, and retrieval settings without changing the entire Knowledge Base.
- Support user-configured embedding model APIs: provider, base URL, API key reference, model name, dimensions, batch size, and extra request body.
- Support provider-specific embedding adapters without leaking provider details into the agent loop.
- Support vector indexes, keyword indexes, hybrid retrieval, rerank adapters, parent-child retrieval, metadata filters, retrieval records, and evaluation hooks.
- Support RAG pipeline traces with lazy detail loading; main trajectory should only show compact progress and citations.
- Treat "Knowledge Base" as the product concept. Vector storage is one possible index backend, not the user-facing abstraction.

**Files:**

- Create: `server/knowledge/knowledgeStore.js`
- Create: `server/knowledge/knowledgeStore.test.js`
- Create: `server/knowledge/knowledgeIngest.js`
- Create: `server/knowledge/knowledgeIngest.test.js`
- Create: `server/knowledge/knowledgeParsers.js`
- Create: `server/knowledge/knowledgeParsers.test.js`
- Create: `server/knowledge/knowledgeChunking.js`
- Create: `server/knowledge/knowledgeChunking.test.js`
- Create: `server/knowledge/knowledgeIndex.js`
- Create: `server/knowledge/knowledgeIndex.test.js`
- Create: `server/knowledge/knowledgeRetrieve.js`
- Create: `server/knowledge/knowledgeRetrieve.test.js`
- Create: `server/knowledge/knowledgePipelineTrace.js`
- Create: `server/knowledge/knowledgePipelineTrace.test.js`
- Create: `server/routes/knowledgeRoutes.js`
- Create: `server/routes/knowledgeRoutes.test.js`
- Add: `server/agent/plugins/KnowledgePlugin.js`
- Modify: server route mounting.
- Create: `src/lib/knowledgeBases.js`
- Create: `src/lib/knowledgeBases.test.js`
- Modify: configuration UI to create, upload/import, test, mount, and unmount Knowledge Bases.
- Modify: `src/components/ContextInspector.jsx`

**Interfaces:**

- `createKnowledgeBase({ name, description, settings }): KnowledgeBase`
- `listKnowledgeBases(): KnowledgeBaseSummary[]`
- `deleteKnowledgeBase({ knowledgeBaseId }): void`
- `parseKnowledgeFile({ filename, mimeType, content, parserConfig }): ParsedKnowledgeDocument`
- `ingestKnowledgeFile({ knowledgeBaseId, filename, mimeType, content, settings }): IngestionResult`
- `previewKnowledgeChunks({ filename, mimeType, content, settings }): KnowledgeChunkPreview[]`
- `retrieveKnowledge({ knowledgeBaseIds, query, topK, maxChars, scoreThreshold }): KnowledgeRetrievalResult`
- `recordKnowledgePipelineEvent({ knowledgeBaseId, runId, stage, status, summary }): void`
- `mountKnowledgeBases({ harnessId, knowledgeBaseIds }): void`

**Steps:**

- [x] Write knowledge store tests for create/list/delete, metadata persistence, path-safe IDs, and runtime directory isolation.
- [x] Implement local metadata, file metadata, chunk storage, and keyword index storage under a gitignored runtime directory.
- [x] Write parser adapter tests for Markdown, plain text, JSON, unsupported file rejection, and safe metadata.
- [x] Write ingestion tests for deterministic chunk IDs, cleanup, per-upload process config, chunk size, and overlap.
- [x] Implement bounded chunking, source metadata, and chunk preview.
- [x] Write retrieval tests for keyword ranking, mounted-base filtering, `topK`, `maxChars`, `scoreThreshold`, and source labels.
- [x] Add lightweight pipeline trace tests for parse, chunk, index, and retrieve stages.
- [x] Add Knowledge Base API routes and route-level validation.
- [x] Add stable Mounted Knowledge Manifest and dynamic Retrieved Knowledge prompt assembly sections.
- [x] Add Auto RAG, Agentic RAG, and Manual Lab runtime strategies.
- [x] Add agentic knowledge list/query tools and tool-pool integration.
- [x] Add lightweight frontend UI for create/import/test/mount and runtime strategy selection without embedding large file contents into the trajectory.
- [x] Split Context Inspector knowledge sections for model-bound manifest and retrieved chunks.
- [ ] Verify and commit with `feat: add local rag knowledge bases`.

### Task 16: RAG Retrieval Quality Extensions

**Goal:** Upgrade retrieval quality after the local RAG MVP has a working end-to-end loop.

**Why:** Production RAG quality usually comes from a pipeline: extraction quality, chunking strategy, keyword/vector/hybrid recall, reranking, metadata filters, and evaluation. These should extend the MVP interfaces rather than rewrite them.

**Scope rule:** Keep this stage modular and experimental. Each quality upgrade should be independently configurable, observable, and removable; do not convert the MVP into a heavyweight enterprise knowledge platform.

**Loop stages:** Knowledge ingestion, retrieval, pre-LLM assembly, retrieval testing.

**Files:**

- Modify: `server/knowledge/knowledgeStore.js`
- Modify: `server/knowledge/knowledgeIngest.js`
- Modify: `server/knowledge/knowledgeParsers.js`
- Modify: `server/knowledge/knowledgePipelineTrace.js`
- Modify: `server/knowledge/knowledgeRetrieve.js`
- Create: `server/knowledge/embeddingProviders.js`
- Create: `server/knowledge/embeddingProviders.test.js`
- Create: `server/knowledge/documentLoaders.js`
- Create: `server/knowledge/documentLoaders.test.js`
- Create: `server/knowledge/vectorIndex.js`
- Create: `server/knowledge/vectorIndex.test.js`
- Create: `server/knowledge/rerankProviders.js`
- Create: `server/knowledge/rerankProviders.test.js`
- Modify: knowledge routes.
- Modify: Knowledge Base settings UI.
- Modify: Context Inspector retrieval details.

**Interfaces:**

- `configureEmbeddingProvider({ provider, baseUrl, apiKeyRef, model, dimensions, batchSize, extraBody })`
- `loadKnowledgeDocument({ filename, mimeType, content, loaderConfig }): ParsedKnowledgeDocument`
- `embedChunks({ providerConfig, chunks }): EmbeddingResult[]`
- `retrieveKnowledge({ strategy: 'keyword' | 'vector' | 'hybrid', rerank, filters, topK, maxChars })`
- `rerankKnowledgeChunks({ providerConfig, query, chunks, topK }): RerankResult[]`
- `buildParentChildChunks({ document, parentSettings, childSettings }): ParentChildChunkGraph`
- `getKnowledgePipelineTrace({ knowledgeBaseId, runId }): KnowledgePipelineTrace`

**Steps:**

- [ ] Add Knowledge Base settings for `indexMethod`, embedding provider config, retrieval strategy, `topK`, score threshold, and max injected chars.
- [ ] Add document loader adapter tests for at least one richer format before enabling it in UI.
- [ ] Add embedding provider adapter tests using fake HTTP responses.
- [ ] Implement configurable embedding API calls without coupling agent loop code to embedding providers.
- [ ] Add vector index adapter behind the `vectorIndex` interface.
- [ ] Add hybrid retrieval tests for keyword + vector result merging.
- [ ] Add rerank adapter tests and fake rerank provider.
- [ ] Add parent-child chunk tests for child matching and parent context return.
- [ ] Add retrieval records for test retrieval and normal agent retrieval.
- [ ] Extend pipeline trace UI with lazy detail loading for parser, chunking, embedding, retrieval, rerank, and injection events.
- [ ] Verify and commit with `feat: extend rag retrieval quality`.

---

## Stage 6: MCP Runtime Layer

### Task 17: Standalone MCP Client MVP

**Goal:** Connect local MCP servers as an independent runtime capability before folding them into a unified resource registry.

**Status:** Complete. Task 18 is the next MCP follow-up.

**Why:** MCP has its own lifecycle: server configuration, startup, initialization, tool discovery, schema translation, tool execution, approval, and tracing. It should prove itself as a working loop before being abstracted as a generic mounted resource.

**Loop stages:** Tool discovery, tool pool dispatch, tool execution, permission approval.

**Files:**

- Create: `server/mcp/mcpServerConfig.js`
- Create: `server/mcp/mcpServerConfig.test.js`
- Create: `server/mcp/mcpClientManager.js`
- Create: `server/mcp/mcpClientManager.test.js`
- Create: `server/mcp/mcpToolAdapter.js`
- Create: `server/mcp/mcpToolAdapter.test.js`
- Modify: tool pool assembly.
- Modify: tool execution dispatch.
- Modify: SecurityPlugin / permission flow integration if needed.
- Create: MCP configuration UI.
- Modify: Context Inspector provider tool schema view.

**Interfaces:**

- `listMcpServers({ harnessId }): McpServerSummary[]`
- `saveMcpServerConfig({ harnessId, server }): McpServerConfig`
- `connectMcpServer({ harnessId, serverId }): McpConnection`
- `listMcpTools({ harnessId, serverId }): ToolDefinition[]`
- `callMcpTool({ harnessId, serverId, toolName, args }): ToolResult`
- `adaptMcpToolSchema(mcpTool): InternalToolDefinition`

**Steps:**

- [x] Write config tests for local stdio MCP server definitions and path-safe storage.
- [x] Implement MCP server config CRUD.
- [x] Write fake MCP server tests for initialize, list tools, and call tool.
- [x] Implement MCP client manager with lifecycle states.
- [x] Write schema adapter tests from MCP tool schema to internal tool schema.
- [x] Route MCP tool calls through existing security and permission approval paths.
- [x] Show MCP tools in tool schema dry-run / Context Inspector.
- [x] Add minimal MCP configuration UI.
- [x] Add generic local Environment / HTTP Header configuration with legacy bearer-env compatibility.
- [x] Verify and commit with `feat: add standalone mcp client`.

### Task 18: MCP Observability And Permission UX

**Goal:** Make MCP runtime behavior visible and controllable without dumping raw server output into the main trajectory.

**Why:** MCP servers can be powerful and risky. Users need clear status, tool schemas, call logs, approval prompts, and failure states.

**Files:**

- Modify: `server/mcp/mcpClientManager.js`
- Create: `server/mcp/mcpRunLog.js`
- Create: `server/mcp/mcpRunLog.test.js`
- Modify: permission notification routes.
- Modify: trajectory event rendering.
- Modify: MCP configuration UI.
- Modify: Context Inspector.

**Steps:**

- [ ] Add MCP server status and reconnect state tests.
- [ ] Add bounded MCP call logs with lazy detail loading.
- [ ] Reuse child-agent permission approval UI for MCP tool calls.
- [ ] Show MCP errors as structured events with server ID, tool name, and safe message.
- [ ] Add Context Inspector section for active MCP tool schemas.
- [ ] Verify and commit with `feat: improve mcp observability`.

---

## Stage 7: Unified Runtime Resource Layer

### Task 19: Runtime Resource Mount Registry

**Goal:** Create one registry for mountable runtime resources after RAG and MCP have independent working loops.

**Why:** Skills, memories, Knowledge Bases, MCP tool servers, project documents, and future provider capabilities are all runtime resources. But the abstraction should come after concrete resource types are proven, not before.

**Loop stages:** Pre-LLM assembly, tool pool dispatch, Context Inspector dry-run.

**Files:**

- Create: `server/agent/resources/resourceMountRegistry.js`
- Create: `server/agent/resources/resourceMountRegistry.test.js`
- Modify: skills plugin.
- Modify: memory visibility.
- Modify: KnowledgePlugin.
- Modify: MCP tool assembly.
- Modify: Context Inspector.

**Interfaces:**

- `listMountableResources({ harnessId }): MountableResource[]`
- `resolveMountedResources({ harnessId, features }): MountedResource[]`
- `assembleResourceContext({ mountedResources, userTurn }): PromptSection[]`
- `assembleResourceTools({ mountedResources }): ToolDefinition[]`
- `summarizeMountedResources({ mountedResources }): MountedResourceSummary[]`

**Steps:**

- [ ] Write registry tests for skills, memory scopes, Knowledge Bases, and MCP tool servers.
- [ ] Move skill catalog, Knowledge Base mount metadata, and MCP mount metadata behind the registry.
- [ ] Keep resource context bounded, source-labeled, and prompt-cache aware.
- [ ] Show mounted resources in Context Inspector without duplicating full runtime dashboards.
- [ ] Verify and commit with `refactor: add runtime resource mount registry`.

### Task 20: Resource Presets And Experiment Profiles

**Goal:** Let users save reusable combinations of guidance, tools, Knowledge Bases, MCP servers, memory scopes, and execution strategy settings.

**Why:** LLM-Space should support both one-click experimental presets and fully detachable component toggles. Profiles are the product layer above the low-level resource registry.

**Files:**

- Create: `server/agent/resources/resourceProfiles.js`
- Create: `server/agent/resources/resourceProfiles.test.js`
- Modify: harness routes.
- Modify: Prompt Lab / configuration UI.
- Modify: Context Inspector resource summary.

**Interfaces:**

- `createResourceProfile({ name, description, mounts, features }): ResourceProfile`
- `applyResourceProfile({ harnessId, profileId }): HarnessPatch`
- `exportResourceProfile({ profileId }): ResourceProfileSnapshot`
- `importResourceProfile({ snapshot }): ResourceProfile`

**Steps:**

- [ ] Add profile store tests for create/list/update/delete/export/import.
- [ ] Implement profile application as a harness patch, not hidden side effects.
- [ ] Add UI to save current runtime configuration as a profile.
- [ ] Add UI to apply a profile while still showing the underlying toggles.
- [ ] Show active profile and expanded resource mounts in Context Inspector.
- [ ] Verify and commit with `feat: add resource experiment profiles`.

---

## Stage 8: Runtime Quality And Maintainability

### Task 21: Runtime Test Harness And E2E Smoke Tests

**Goal:** Add test coverage for the full agent run lifecycle without depending on real model calls.

**Why:** Unit tests cover many pieces, but the full loop needs fake-model integration tests for stream events, tool calls, permissions, notifications, and final persistence.

**Files:**

- Create: `server/test/fakeModelServer.js`
- Create: `server/agent/runtimeHarness.test.js`
- Create: `src/test/trajectorySmoke.test.js` if frontend test tooling is added.
- Modify: `package.json` scripts if needed.

**Interfaces:**

- `createFakeModel({ script }): ModelGateway`
- `runRuntimeScenario({ messages, tools, modelScript }): RuntimeScenarioResult`

**Steps:**

- [ ] Write scenarios for final answer, one tool call, invalid tool args, permission wait, security block, teammate notification, and cron notification.
- [ ] Add a coverage script only after tests are stable.
- [ ] Keep fake model scripts small and readable.
- [ ] Verify and commit with `test: add runtime harness smoke tests`.

### Task 22: Observability And Debug Surfaces

**Goal:** Make runtime state understandable without dumping huge raw traces into the main UI.

**Why:** The frontend has already paid for unbounded output. Observability must be structured and lazy.

**Files:**

- Modify: `src/components/ContextInspector.jsx`
- Modify: `src/components/TrajectoryView.jsx`
- Modify: child trace components.
- Add server-side summary endpoints as needed.

**Surfaces:**

- Runtime request summary.
- Active loop stage.
- Tool pool summary.
- Mounted resources summary.
- Runtime notifications summary.
- Child-agent/team status with lazy trace links.
- Model gateway profile and context window.

**Steps:**

- [ ] Add summary builders on the server where raw data is too large.
- [ ] Add UI tests for bounded rendering and lazy trace loading.
- [ ] Avoid rendering full child trajectories in the main message tree.
- [ ] Verify and commit with `feat: improve runtime observability surfaces`.

---

## Active Acceptance Criteria

- `docs/superpowers/plans/` contains only this active roadmap unless a concrete implementation batch intentionally splits out.
- Completed historical plans live under `docs/superpowers/plans/archive/`.
- Every future feature declares its loop stage before implementation.
- Every runtime boundary has tests before code changes.
- `npm test` passes before merging any runtime batch.
- `npm run build` passes before merging any frontend-impacting batch.
- Large outputs, child traces, teammate reports, and knowledge contents are never eagerly rendered in the main trajectory.
- Memory writes, model provider calls, knowledge mounts, MCP tools, and team protocols have visible runtime boundaries and can be independently disabled.

## Notes

- This roadmap intentionally does not reintroduce child-agent turn limits. The direction is to rely on runtime contracts, observability, permission flow, cancellation semantics, and isolation.
- `sub_agent` and `agent_teams` are harness-profile compositions over shared child-agent primitives.
- Commercial-style one-click strategies can be added later, but the experimental platform must keep primitives independently toggleable.
- Vector RAG is a later optimization for Knowledge Bases. The MVP starts with source-labeled local chunks and keyword retrieval, while preserving embedding provider and hybrid retrieval extension points.
- MCP support should first prove itself as a standalone runtime loop, then be folded into the Runtime Resource Mount Registry after RAG and MCP both have working concrete implementations.
