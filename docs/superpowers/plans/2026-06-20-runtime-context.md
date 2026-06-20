# Runtime Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable per-executor environment metadata to the system prompt and provide exact current time through an always-available tool.

**Architecture:** A pure runtime-context module reads Node standard APIs and formats an escaped XML block. `AgentExecutor` composes that block with the configured system prompt once during construction, while a separate parameterless tool reads the clock on demand and is registered as a foundational executor tool.

**Tech Stack:** Node.js ES modules, Node test runner, existing `ToolRegistry` and `AgentExecutor`.

## Global Constraints

- Use only Node.js standard APIs; add no dependency or feature flag.
- Generate runtime metadata once per executor and reuse it across all ReAct cycles.
- Use `process.cwd()` for the working directory.
- Keep exact time out of the system prompt and read it only through `get_current_time`.
- Do not persist runtime metadata or expose hostname and username.

---

### Task 1: Runtime Context Formatting

**Files:**
- Create: `server/agent/runtimeContext.js`
- Test: `server/agent/runtimeContext.test.js`

**Interfaces:**
- Produces: `getRuntimeMetadata(options?)`, `formatRuntimeContext(metadata)`, and `composeSystemPrompt(systemPrompt, runtimeContext)`.
- `options` accepts injectable `now`, `timeZone`, `platform`, `arch`, and `cwd` values for deterministic tests.

- [ ] **Step 1: Write failing formatting and composition tests**

Test deterministic metadata, platform mapping, XML escaping, empty prompts, and non-empty prompts using `node:test` and `node:assert/strict`.

- [ ] **Step 2: Verify the tests fail for the missing module**

Run: `node --test server/agent/runtimeContext.test.js`

Expected: FAIL because `server/agent/runtimeContext.js` does not exist.

- [ ] **Step 3: Implement the pure runtime-context functions**

Use `Intl.DateTimeFormat(...).formatToParts()` for the timezone-aware date, map known Node platforms to user-facing names, escape XML text, and concatenate the configured prompt with one blank line.

- [ ] **Step 4: Verify runtime-context tests pass**

Run: `node --test server/agent/runtimeContext.test.js`

Expected: all runtime-context tests PASS.

- [ ] **Step 5: Commit runtime-context formatting**

```bash
git add server/agent/runtimeContext.js server/agent/runtimeContext.test.js
git commit -m "feat(agent): build runtime context metadata"
```

### Task 2: Executor System-Prompt Composition

**Files:**
- Modify: `server/agent/AgentExecutor.js`
- Test: `server/agent/AgentExecutor.runtimeContext.test.js`

**Interfaces:**
- Consumes: `getRuntimeMetadata`, `formatRuntimeContext`, and `composeSystemPrompt` from Task 1.
- Produces: `executor.systemPrompt` containing the original prompt followed by exactly one runtime-context block.

- [ ] **Step 1: Write a failing executor construction test**

Construct an executor with a known base prompt and assert that `systemPrompt` retains the base prompt and includes one `<runtime_context>` block with the working directory.

- [ ] **Step 2: Verify the executor test fails**

Run: `node --test server/agent/AgentExecutor.runtimeContext.test.js`

Expected: FAIL because executor construction does not append runtime metadata.

- [ ] **Step 3: Compose the system prompt once in the constructor**

Import the Task 1 helpers, build one metadata snapshot, and assign the composed result to `this.systemPrompt`. Leave loop-level context assembly unchanged.

- [ ] **Step 4: Verify executor and runtime-context tests pass**

Run: `node --test server/agent/runtimeContext.test.js server/agent/AgentExecutor.runtimeContext.test.js`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit executor integration**

```bash
git add server/agent/AgentExecutor.js server/agent/AgentExecutor.runtimeContext.test.js
git commit -m "feat(agent): inject runtime context into system prompt"
```

### Task 3: On-Demand Current-Time Tool

**Files:**
- Create: `server/tools/get_current_time.js`
- Create: `server/tools/get_current_time.test.js`
- Modify: `server/tools/ToolRegistry.js`
- Modify: `server/agent/AgentExecutor.js`
- Test: `server/agent/AgentExecutor.runtimeContext.test.js`

**Interfaces:**
- Produces: parameterless tool `get_current_time`, returning `{ date, time, timezone, iso }`.
- Consumes: runtime timezone/date formatting behavior from Task 1.
- Produces: every executor tool list contains exactly one `get_current_time` entry.

- [ ] **Step 1: Write failing tool-output and automatic-registration tests**

Test deterministic output using an injectable clock helper exported by the tool module, then assert a newly constructed executor includes `get_current_time` exactly once even when supplied explicitly.

- [ ] **Step 2: Verify the tests fail**

Run: `node --test server/tools/get_current_time.test.js server/agent/AgentExecutor.runtimeContext.test.js`

Expected: FAIL because the tool and automatic registration are absent.

- [ ] **Step 3: Implement and register the tool**

Format local date and `HH:mm:ss` in the detected timezone, return `Date#toISOString()` as `iso`, register the module in `ToolRegistry`, and append its name once in the executor constructor.

- [ ] **Step 4: Run focused and complete verification**

Run: `node --test server/**/*.test.js`

Expected: all server tests PASS.

Run: `npm run lint`

Expected: exit code 0.

Run: `npm run build`

Expected: exit code 0.

- [ ] **Step 5: Commit the current-time tool**

```bash
git add server/tools/get_current_time.js server/tools/get_current_time.test.js server/tools/ToolRegistry.js server/agent/AgentExecutor.js server/agent/AgentExecutor.runtimeContext.test.js
git commit -m "feat(agent): add on-demand current time tool"
```
