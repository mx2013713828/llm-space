# Agent Runtime Reliability Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current best-effort agent loop, teammate runner, tool execution, memory, and trajectory UI into explicit runtime contracts so trace-inspection questions do not trigger new tools, teammate failures are visible, invalid tool calls are typed, and frontend rendering remains stable under multi-agent streams.

**Architecture:** Add a small runtime contract layer between user input and `AgentExecutor`: `InteractionMode` decides whether this turn may use tools, `ToolInvocationValidator` classifies malformed calls before execution, teammate outcomes become structured envelopes, and the frontend consumes normalized events through a reducer-backed view model. Memory becomes mode-aware so diagnostic/trace-inspection turns do not get anchored to stale memories.

**Tech Stack:** Node.js ES modules, Express SSE, existing `AgentExecutor`/HookManager/tool registry, React 19, existing stream reducers, Node test runner.

## Global Constraints

- Do not solve this by only changing prompts, increasing max turns, or hiding UI output.
- Preserve the existing Anthropic-compatible protocol and DeepSeek model compatibility.
- Keep Teams finite and local; do not introduce autonomous background workers in this plan.
- Keep large teammate/sub-agent traces lazy-loaded and bounded in the primary trajectory UI.
- Every task must add regression tests before implementation.
- Every task must be independently commit-ready.

---

## Evidence From Code Review

- `AgentExecutor.run()` builds every normal LLM cycle with the full resolved tool list. There is no first-class "answer from existing trajectory only" mode. See `server/agent/AgentExecutor.js`.
- `synthesizeFinalAfterToolTurnLimit()` is the only path that explicitly uses `tools: []`, which proves the executor already can run no-tool answer turns, but only for turn-limit recovery.
- `ToolRegistry.execute()` sends `toolInput || {}` directly to tool implementations. Required fields are only exposed in schema, not validated before execution.
- `read_file` treats missing path as a returned string (`Failed to read file: Missing parameter...`) instead of a typed invalid-arguments result.
- `runTeammate()` can classify `no_result`, but still sends an inbox payload with placeholder content as `type: result`, making missing final reports too easy for the lead to summarize as if valid.
- `useAgentLoop()` mixes SSE deltas, `messages_update` snapshots, active session polling, final session refresh, and scheduled-message sync into the same `messages` state.
- `MemoryPlugin` injects and extracts memories on normal lead turns without awareness of trace-inspection/debugging mode, so stale memories can bias diagnosis.

---

## Task 1: Add Interaction Mode And Tool Policy

**Files:**
- Create: `server/agent/runtime/interactionMode.js`
- Create: `server/agent/runtime/interactionMode.test.js`
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server.js`

**Interfaces:**
- Produces: `resolveInteractionMode({ messages, requestedMode }): { mode, toolPolicy, reason }`.
- Produces: `applyToolPolicyToContext(context, policy): void`.
- Consumes: latest user message content and optional request metadata.
- `toolPolicy` values: `'normal' | 'none'`.

- [ ] **Step 1: Write failing interaction mode tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInteractionMode } from './interactionMode.js';

test('uses no tools for questions about previous tool calls', () => {
  const result = resolveInteractionMode({
    messages: [{ role: 'user', content: '你刚才为什么要调用 read_file？' }],
  });

  assert.equal(result.mode, 'trace_inspection');
  assert.equal(result.toolPolicy, 'none');
  assert.match(result.reason, /previous tool/i);
});

test('uses normal tools for explicit new work', () => {
  const result = resolveInteractionMode({
    messages: [{ role: 'user', content: '读取 server.js 并解释 836 行附近的逻辑' }],
  });

  assert.equal(result.mode, 'normal');
  assert.equal(result.toolPolicy, 'normal');
});

test('respects explicit requested mode from the API payload', () => {
  const result = resolveInteractionMode({
    requestedMode: 'trace_inspection',
    messages: [{ role: 'user', content: '这次普通问题也不要调用工具' }],
  });

  assert.equal(result.mode, 'trace_inspection');
  assert.equal(result.toolPolicy, 'none');
});
```

- [ ] **Step 2: Implement deterministic mode resolution**

Create `server/agent/runtime/interactionMode.js`:

```js
const TRACE_INSPECTION_PATTERNS = [
  /为什么.*调用.*(tool|工具|read_file|bash|spawn_teammate)/i,
  /(刚才|上一轮|之前).*(调用|工具|轨迹|返回|输出)/i,
  /(解释|分析).*(执行轨迹|trajectory|tool call|工具调用)/i,
  /(teammate|sub-agent|子代理).*(为什么|返回了什么|没输出|只返回)/i,
];

export function resolveInteractionMode({ messages = [], requestedMode = '' } = {}) {
  if (requestedMode === 'trace_inspection') {
    return { mode: 'trace_inspection', toolPolicy: 'none', reason: 'explicit requested mode' };
  }

  const lastUser = [...messages].reverse().find(message => message?.role === 'user');
  const text = String(lastUser?.content || '');
  const matched = TRACE_INSPECTION_PATTERNS.some(pattern => pattern.test(text));

  if (matched) {
    return { mode: 'trace_inspection', toolPolicy: 'none', reason: 'question about previous tool/trajectory behavior' };
  }

  return { mode: 'normal', toolPolicy: 'normal', reason: 'default' };
}

export function applyToolPolicyToContext(context, policy) {
  if (policy?.toolPolicy === 'none') {
    context.tools = [];
    context.systemPrompt = `${context.systemPrompt || ''}\n\n<runtime_contract>\nThis turn is trace inspection. Answer only from the existing conversation and persisted trajectory context. Do not call tools. If evidence is missing, say what is missing instead of attempting a new tool call.\n</runtime_contract>`;
  }
}
```

- [ ] **Step 3: Wire mode into `AgentExecutor`**

Add constructor input:

```js
interactionMode = null,
```

Store it:

```js
this.interactionMode = interactionMode || resolveInteractionMode({ messages: this.messages });
```

During each cycle, after building context and before `preLLM`:

```js
applyToolPolicyToContext(context, this.interactionMode);
```

- [ ] **Step 4: Wire optional mode through `/api/agent/run`**

Read `interactionMode` from `req.body`, pass it to `AgentExecutor`, and default to server-side inference.

- [ ] **Step 5: Verify**

Run:

```bash
node --test server/agent/runtime/interactionMode.test.js server/agent/AgentExecutor.stream.test.js
```

- [ ] **Step 6: Commit**

```bash
git add server/agent/runtime/interactionMode.js server/agent/runtime/interactionMode.test.js server/agent/AgentExecutor.js server.js
git commit -m "feat: add runtime interaction tool policy"
```

---

## Task 2: Add Tool Invocation Validation And Typed Tool Results

**Files:**
- Create: `server/tools/toolValidation.js`
- Create: `server/tools/toolValidation.test.js`
- Modify: `server/tools/ToolRegistry.js`
- Modify: `server/agent/AgentExecutor.js`
- Modify: `src/lib/streamMessageUpdates.js`
- Modify: `src/lib/streamMessageUpdates.test.js`
- Modify: `src/components/MessageBubbles.jsx`

**Interfaces:**
- Produces: `validateToolInput(tool, input): { ok, code?, message?, details? }`.
- Produces: `toolRegistry.validate(toolName, toolInput)`.
- Adds message fields: `toolStatus: 'pending' | 'running' | 'completed' | 'invalid_args' | 'failed'`.

- [ ] **Step 1: Write failing validation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import readFile from './read_file.js';
import { validateToolInput } from './toolValidation.js';

test('rejects missing required string parameters', () => {
  assert.deepEqual(validateToolInput(readFile, {}), {
    ok: false,
    code: 'missing_required_parameter',
    message: 'read_file requires parameter "path".',
    details: { parameter: 'path', expectedType: 'string' },
  });
});

test('accepts valid required parameters', () => {
  assert.deepEqual(validateToolInput(readFile, { path: 'server.js' }), { ok: true });
});
```

- [ ] **Step 2: Implement validator**

Validate required fields and primitive types from each tool's existing `parameters` object. Keep this dependency-free.

- [ ] **Step 3: Gate execution in `AgentExecutor`**

Before `toolRegistry.execute(...)`:

```js
const validation = toolRegistry.validate(tool.toolName, tool.toolInput);
if (!validation.ok) {
  tool.toolStatus = 'invalid_args';
  tool.toolOutput = `[Invalid tool arguments]\n${validation.message}`;
  this.onEvent('tool_exec_invalid', {
    id: tool.id,
    toolName: tool.toolName,
    error: validation,
  });
  return;
}
```

Only call real tool code when validation passes.

- [ ] **Step 4: Add stream/UI support**

In `streamMessageUpdates.js`, handle `tool_exec_invalid` by setting `toolStatus: 'invalid_args'` and a readable output. In `MessageBubbles.jsx`, show an error badge for invalid args.

- [ ] **Step 5: Verify**

Run:

```bash
node --test server/tools/toolValidation.test.js server/tools/ToolRegistry.test.js src/lib/streamMessageUpdates.test.js
```

- [ ] **Step 6: Commit**

```bash
git add server/tools/toolValidation.js server/tools/toolValidation.test.js server/tools/ToolRegistry.js server/agent/AgentExecutor.js src/lib/streamMessageUpdates.js src/lib/streamMessageUpdates.test.js src/components/MessageBubbles.jsx
git commit -m "feat: validate tool invocations before execution"
```

---

## Task 3: Make Teammate Outcomes Structured And Non-Ambiguous

**Files:**
- Create: `server/agent/teams/teammateOutcome.js`
- Create: `server/agent/teams/teammateOutcome.test.js`
- Modify: `server/agent/teams/teammateRunner.js`
- Modify: `server/agent/plugins/TeamPlugin.js`
- Modify: `server/agent/teams/teammateRunner.test.js`
- Modify: `server/agent/plugins/TeamPlugin.test.js`

**Interfaces:**
- Produces: `buildTeammateOutcome({ messages, stopReason, maxTurns }): TeammateOutcome`.
- `TeammateOutcome.status`: `'completed' | 'no_result' | 'turn_limit' | 'failed'`.
- Inbox `type` for non-completed teammate outcomes must be `'error'`, not `'result'`.

- [ ] **Step 1: Write failing outcome tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeammateOutcome } from './teammateOutcome.js';

test('does not treat a pre-tool progress text as final result', () => {
  const outcome = buildTeammateOutcome({
    messages: [
      { role: 'assistant', type: 'text', content: 'I will inspect files.' },
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
    ],
    stopReason: 'end_turn',
    maxTurns: 8,
  });

  assert.equal(outcome.status, 'no_result');
  assert.equal(outcome.content, '');
  assert.match(outcome.error, /final text report/i);
});

test('accepts final text after the last tool call', () => {
  const outcome = buildTeammateOutcome({
    messages: [
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
      { role: 'assistant', type: 'text', content: 'Final report.' },
    ],
    stopReason: 'end_turn',
    maxTurns: 8,
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.content, 'Final report.');
});
```

- [ ] **Step 2: Implement outcome builder**

Move `getFinalAssistantTextAfterLastTool()` logic into `teammateOutcome.js` and return a structured object with `status`, `content`, `error`, `lastToolName`, and `messageCount`.

- [ ] **Step 3: Update `runTeammate()`**

Use the outcome object for trace status, team state, and inbox messages:

```js
const messageType = outcome.status === 'completed' ? 'result' : 'error';
const payload = outcome.status === 'completed'
  ? { teammateId, name, role: role ?? null, content: outcome.content }
  : { teammateId, name, role: role ?? null, error: outcome.error, status: outcome.status };
```

- [ ] **Step 4: Update wait/inbox formatting**

`wait_for_teammates` should show `no_result` as terminal but unhealthy. `check_team_inbox` should label it as an error and tell the lead to use trace if needed.

- [ ] **Step 5: Verify**

Run:

```bash
node --test server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.test.js server/agent/plugins/TeamPlugin.test.js
```

- [ ] **Step 6: Commit**

```bash
git add server/agent/teams/teammateOutcome.js server/agent/teams/teammateOutcome.test.js server/agent/teams/teammateRunner.js server/agent/plugins/TeamPlugin.js server/agent/teams/teammateRunner.test.js server/agent/plugins/TeamPlugin.test.js
git commit -m "fix: make teammate outcomes explicit"
```

---

## Task 4: Split Live Stream State From Persisted Session Snapshots

**Files:**
- Create: `src/lib/runViewModel.js`
- Create: `src/lib/runViewModel.test.js`
- Modify: `src/hooks/useAgentLoop.js`
- Modify: `src/lib/agentRunCompletion.js`
- Modify: `src/lib/agentRunCompletion.test.js`

**Interfaces:**
- Produces: `createRunViewModelState(snapshot)`.
- Produces: `applyRunEvent(state, event): state`.
- Produces: `applySessionSnapshotToRunState(state, snapshot, { phase }): state`.
- Persisted snapshots may update completed messages but must not overwrite active streamed blocks.

- [ ] **Step 1: Write failing reducer tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunViewModelState,
  applyRunEvent,
  applySessionSnapshotToRunState,
} from './runViewModel.js';

test('active stream text is not overwritten by a stale messages_update snapshot', () => {
  let state = createRunViewModelState({ messages: [] });
  state = applyRunEvent(state, { type: 'text_start', id: 'txt_1', turn: 1 });
  state = applyRunEvent(state, { type: 'text_delta', id: 'txt_1', text: 'live text' });

  state = applySessionSnapshotToRunState(state, {
    messages: [{ id: 'txt_1', role: 'assistant', type: 'text', content: 'old' }],
  }, { phase: 'active' });

  assert.equal(state.messages[0].content, 'live text');
  assert.equal(state.messages[0].streaming, true);
});
```

- [ ] **Step 2: Implement run view model**

Wrap existing `applyStreamMessageEvent()` rather than rewriting it wholesale. Track `activeMessageIds` and only merge snapshots into inactive messages while running.

- [ ] **Step 3: Refactor `useAgentLoop()` to use the reducer**

Move direct `setMessages(evt.messages)` from active `messages_update` to `applySessionSnapshotToRunState(..., { phase: 'active' })`. On final `done`, flush stream events and then apply final snapshot with `{ phase: 'done' }`.

- [ ] **Step 4: Make active polling conservative**

`reconcileActiveRunSession` should never replace active stream blocks. It may update todos/background tasks and inactive historical messages only.

- [ ] **Step 5: Verify**

Run:

```bash
node --test src/lib/runViewModel.test.js src/lib/agentRunCompletion.test.js src/lib/streamMessageUpdates.test.js
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/runViewModel.js src/lib/runViewModel.test.js src/hooks/useAgentLoop.js src/lib/agentRunCompletion.js src/lib/agentRunCompletion.test.js
git commit -m "fix: separate live stream state from session snapshots"
```

---

## Task 5: Make Memory Mode-Aware For Diagnostics

**Files:**
- Modify: `server/agent/plugins/MemoryPlugin.js`
- Modify: `server/agent/plugins/MemoryPlugin.test.js`
- Modify: `server/agent/memory/memoryExtract.js`
- Create: `server/agent/memory/memoryExtract.test.js`

**Interfaces:**
- Consumes: `executor.interactionMode`.
- Memory injection modes: `'normal' | 'index_only' | 'disabled_for_turn'`.
- Memory extraction should skip trace-inspection turns.

- [ ] **Step 1: Write failing tests**

```js
test('skips concrete memory injection for trace inspection turns', async () => {
  const context = createMemoryContext({
    interactionMode: { mode: 'trace_inspection', toolPolicy: 'none' },
  });

  await MemoryPlugin.preLLM(context);

  assert.doesNotMatch(context.apiMessages[0].content[0].text, /<memory_context>/);
});

test('does not extract memories after trace inspection answers', async () => {
  const calls = [];
  await MemoryPlugin.onLoopEnd(createLoopEndContext({
    interactionMode: { mode: 'trace_inspection', toolPolicy: 'none' },
    extractCalls: calls,
  }));

  assert.deepEqual(calls, []);
});
```

- [ ] **Step 2: Implement memory mode gate**

In `MemoryPlugin.preLLM`, if `executor.interactionMode.mode === 'trace_inspection'`, skip `selectAndLoadMemories()` and concrete `<memory_context>` injection. Keep or omit index based on cache impact; default to omit concrete memories.

- [ ] **Step 3: Make extraction conservative**

Add a deterministic post-filter in `memoryExtract.js`:

```js
const TRANSIENT_MEMORY_PATTERNS = [
  /teammate|checker|审查报告|P0|P1|P2|当前任务|这次|本轮|执行轨迹/i,
];
```

Reject transient review artifacts and cap extracted items per turn to 2.

- [ ] **Step 4: Verify**

Run:

```bash
node --test server/agent/plugins/MemoryPlugin.test.js server/agent/memory/memoryExtract.test.js
```

- [ ] **Step 5: Commit**

```bash
git add server/agent/plugins/MemoryPlugin.js server/agent/plugins/MemoryPlugin.test.js server/agent/memory/memoryExtract.js server/agent/memory/memoryExtract.test.js
git commit -m "fix: make memory conservative for diagnostics"
```

---

## Task 6: Improve Trajectory Observability Without Large Inline Payloads

**Files:**
- Modify: `src/components/MessageBubbles.jsx`
- Modify: `src/components/TrajectoryView.jsx`
- Modify: `src/lib/teamStatusPresentation.js`
- Modify: `src/lib/messagePresentation.js`
- Create: `src/lib/runtimeStatusPresentation.js`
- Create: `src/lib/runtimeStatusPresentation.test.js`

**Interfaces:**
- Produces: `getToolStatusPresentation(message)`.
- Produces: `getTeammateStatusPresentation(teammate)`.
- Tool cards expose status, source, and error class without requiring expansion.

- [ ] **Step 1: Write presentation tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getToolStatusPresentation } from './runtimeStatusPresentation.js';

test('presents invalid tool args as an error state', () => {
  assert.deepEqual(getToolStatusPresentation({
    type: 'tool_call',
    toolName: 'read_file',
    toolStatus: 'invalid_args',
  }), {
    label: 'invalid args',
    tone: 'danger',
  });
});
```

- [ ] **Step 2: Add card-level status**

Show `running`, `completed`, `invalid args`, `failed`, `no result`, and `turn limit` badges on collapsed cards.

- [ ] **Step 3: Keep full details lazy**

Do not inline teammate trace, huge inbox reports, or large tool outputs by default. Keep existing lazy trace loading and visible-count pagination.

- [ ] **Step 4: Verify**

Run:

```bash
node --test src/lib/runtimeStatusPresentation.test.js
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageBubbles.jsx src/components/TrajectoryView.jsx src/lib/teamStatusPresentation.js src/lib/messagePresentation.js src/lib/runtimeStatusPresentation.js src/lib/runtimeStatusPresentation.test.js
git commit -m "feat: improve runtime status observability"
```

---

## Task 7: Add End-To-End Regression Fixtures

**Files:**
- Create: `server/agent/runtime/reliabilityScenarios.test.js`
- Create: `src/lib/runViewModel.integration.test.js`

**Scenarios:**
- User asks why a previous tool was called; executor sends no tool schemas.
- Model attempts an empty `read_file` call; validator marks `invalid_args` and does not execute the tool.
- Teammate finishes with only a tool call; inbox receives an error outcome, not a result.
- `wait_for_teammates` returns status only; `check_team_inbox` is required for content.
- Active stream text is not replaced by a stale snapshot.
- Large teammate report is offloaded and represented by a preview plus path.

- [ ] **Step 1: Write backend scenario tests**

Use fake executors/model stubs where possible to avoid network calls.

- [ ] **Step 2: Write frontend reducer integration tests**

Replay the problematic event order: text starts, tool call appears, stale snapshot arrives, final snapshot arrives.

- [ ] **Step 3: Run complete targeted suite**

```bash
node --test \
  server/agent/runtime/interactionMode.test.js \
  server/tools/toolValidation.test.js \
  server/agent/teams/teammateOutcome.test.js \
  server/agent/teams/teammateRunner.test.js \
  server/agent/plugins/TeamPlugin.test.js \
  src/lib/runViewModel.test.js \
  src/lib/runViewModel.integration.test.js \
  src/lib/streamMessageUpdates.test.js
```

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add server/agent/runtime/reliabilityScenarios.test.js src/lib/runViewModel.integration.test.js
git commit -m "test: cover agent runtime reliability scenarios"
```

---

## Manual Acceptance Tests

1. Ask: `你刚才为什么要调用 read_file？`
   - Expected: no new tool call appears.
   - Expected: answer says it is using existing trajectory only.

2. Ask with async teams: `请用 async teams 检查当前执行策略层。启动三个 teammate：backend 检查后端，frontend 检查前端，tests 检查测试。等待所有 teammate 返回后，再给我综合结论。`
   - Expected: three spawn cards remain distinct.
   - Expected: `wait_for_teammates` output is status-only.
   - Expected: final answer must follow `check_team_inbox`.
   - Expected: any teammate without final report is shown as `no_result` or `turn_limit`, not summarized as successful.

3. Force bad tool args with a fixture or stubbed model event for `read_file {}`.
   - Expected: tool card says `invalid args`.
   - Expected: no filesystem read occurs.

4. During long teammate output, keep the trajectory page open.
   - Expected: no browser freeze.
   - Expected: no transient teammate text appears in lead messages and disappears later.

5. Ask a diagnostic question after a failed teammate run.
   - Expected: memory context does not inject old teammate-failure memories into the prompt for that diagnostic answer.

---

## Rollout Order

1. Task 1 prevents the most visible failure: explaining historical tool calls should not invoke new tools.
2. Task 2 prevents malformed tool calls from becoming ordinary outputs.
3. Task 3 makes teammate output reliability explicit.
4. Task 4 stabilizes frontend rendering under mixed stream/snapshot traffic.
5. Task 5 reduces stale-memory anchoring during diagnostics.
6. Task 6 improves observability after the contracts exist.
7. Task 7 locks the behavior with regression fixtures.

