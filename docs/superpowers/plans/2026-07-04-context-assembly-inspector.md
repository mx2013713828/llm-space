# Context Assembly Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Context Inspector a fast, clear view of exactly what the current agent request sends to the model: assembled system prompt, message payload, and provider tool schema.

**Architecture:** Introduce structured prompt assembly metadata on the server, pin the active execution strategy into the system prompt, and make dry-run context inspection deterministic and non-LLM-calling. Replace the current mixed dashboard-style Context Inspector with a split assembly viewer that defaults to summaries and renders full content only on demand.

**Tech Stack:** Node.js ESM, `node:test`, existing AgentExecutor hook pipeline, React, Vite, existing CSS variables.

## Global Constraints

- Context Inspector must only default-show content that is sent to the model: system prompt, messages, and provider tool schema.
- Runtime Tool Pool, Runtime Notification Queue, and Memory Candidate Queue are not prompt context and must not be shown in the default Context Inspector view.
- Static dry-run for Context Inspector must not call an LLM, must not mutate runtime queues, and must not perform memory side-query selection.
- Active execution strategy full guideline must be pinned into the system prompt, not appended to the latest user message.
- The UI must support complete content inspection without eagerly rendering every large payload section.
- Preserve existing API compatibility where practical; `systemPrompt` may remain the transport field for AGENTS.md content.
- Do not stage or commit unrelated dirty files such as `harnesses/01-chat-bot.json` or unrelated untracked docs.

---

## File Structure

- `server/agent/promptAssembly/promptAssembly.js`
  - Owns prompt assembly section creation, target/lifecycle labels, text-size summaries, and safe append helpers.
- `server/agent/promptAssembly/promptAssembly.test.js`
  - Tests section creation, append behavior, stable ordering, and summary metadata.
- `server/agent/runtimeContext.js`
  - Changes runtime context composition from plain string concatenation to reusable sections.
- `server/agent/AgentExecutor.js`
  - Initializes `executor.promptAssemblySections` and carries dry-run inspection mode.
- `server/agent/plugins/ExecutionStrategyPlugin.js`
  - Pins available strategy index and active strategy guideline into system prompt sections.
- `server/agent/plugins/TaskSystemPlugin.js`
  - Records task-system guideline and dependency graph as system sections.
- `server/agent/plugins/TodoNagPlugin.js`
  - Records todo guideline as a system section and leaves live todo state as message context.
- `server/agent/plugins/MemoryPlugin.js`
  - Records memory index as a system section; skips concrete memory side-query during static context inspection.
- `server/agent/plugins/SkillsPlugin.js`
  - Records available skills as a system section.
- `server/routes/harnessRoutes.js`
  - Adds `dryRunMode: 'static_context'`, returns `promptAssembly`, and avoids sidecar queue summaries in Context Inspector response.
- `server/routes/harnessRoutes.test.js`
  - Tests static dry-run avoids LLM-backed memory selection and returns prompt assembly sections.
- `server/agent/plugins/ExecutionStrategyPlugin.test.js`
  - Tests active strategy is pinned to system and not appended to user messages.
- `server/agent/plugins/MemoryPlugin.test.js`
  - Tests context inspection skips memory side-query but keeps memory index.
- `src/lib/contextInspectorModel.js`
  - Converts dry-run response into split-view rows without scanning huge text with regex.
- `src/lib/contextInspectorModel.test.js`
  - Tests row grouping, default selection, sent-to-model filtering, and size labels.
- `src/components/ContextInspector.jsx`
  - Replaces mixed dashboard cards with a split assembly UI.
- `docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md`
  - Renumbers Stage 5 around Task 11-16 and marks Task 13 as this work.

---

### Task 1: Prompt Assembly Section Model

**Files:**
- Create: `server/agent/promptAssembly/promptAssembly.js`
- Create: `server/agent/promptAssembly/promptAssembly.test.js`
- Modify: `server/agent/runtimeContext.js`
- Modify: `server/agent/AgentExecutor.runtimeContext.test.js`

**Interfaces:**
- Produces: `createPromptSection({ id, label, target, lifecycle, source, content, order, sentToModel, cacheImpact, metadata }): PromptAssemblySection`
- Produces: `appendSystemPromptSection(context, section): void`
- Produces: `summarizePromptAssembly(sections): { sections: PromptAssemblySectionSummary[], totals: { chars, sentToModelChars } }`
- Produces: `composeSystemPromptSections({ agentGuidance, guidanceFile, runtimeContext }): { text, sections }`
- Consumes: existing `formatRuntimeContext(metadata): string`

- [ ] **Step 1: Write failing section model tests**

Create `server/agent/promptAssembly/promptAssembly.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendSystemPromptSection,
  composeSystemPromptSections,
  createPromptSection,
  summarizePromptAssembly,
} from './promptAssembly.js';

test('createPromptSection normalizes metadata for sent model context', () => {
  const section = createPromptSection({
    id: 'active_execution_strategy',
    label: 'Active Strategy',
    target: 'system',
    lifecycle: 'pinned',
    source: 'strategy:async_teams',
    content: '<active_execution_strategy>...</active_execution_strategy>',
    order: 30,
    sentToModel: true,
    cacheImpact: 'stable_until_strategy_changes',
  });

  assert.deepEqual(section, {
    id: 'active_execution_strategy',
    label: 'Active Strategy',
    target: 'system',
    lifecycle: 'pinned',
    source: 'strategy:async_teams',
    content: '<active_execution_strategy>...</active_execution_strategy>',
    order: 30,
    sentToModel: true,
    cacheImpact: 'stable_until_strategy_changes',
    chars: 54,
    metadata: {},
  });
});

test('appendSystemPromptSection appends text and records the section once', () => {
  const context = {
    systemPrompt: 'base',
    promptAssemblySections: [],
  };
  const section = createPromptSection({
    id: 'todo_guidelines',
    label: 'Todo Guidelines',
    target: 'system',
    lifecycle: 'pinned',
    source: 'feature:task_orchestration.todo_prompt',
    content: '<todo_mode_guidelines>Use todos.</todo_mode_guidelines>',
    order: 50,
  });

  appendSystemPromptSection(context, section);
  appendSystemPromptSection(context, section);

  assert.equal(
    context.systemPrompt,
    'base\n\n<todo_mode_guidelines>Use todos.</todo_mode_guidelines>',
  );
  assert.deepEqual(context.promptAssemblySections.map(item => item.id), ['todo_guidelines']);
});

test('composeSystemPromptSections builds AGENTS.md plus runtime context sections', () => {
  const result = composeSystemPromptSections({
    agentGuidance: 'You are helpful.',
    guidanceFile: 'guidance/02-bash/AGENTS.md',
    runtimeContext: '<runtime_context>today</runtime_context>',
  });

  assert.equal(
    result.text,
    'You are helpful.\n\n<runtime_context>today</runtime_context>',
  );
  assert.deepEqual(result.sections.map(section => ({
    id: section.id,
    target: section.target,
    source: section.source,
    order: section.order,
  })), [
    {
      id: 'agent_guidance',
      target: 'system',
      source: 'guidance/02-bash/AGENTS.md',
      order: 10,
    },
    {
      id: 'runtime_context',
      target: 'system',
      source: 'runtime',
      order: 20,
    },
  ]);
});

test('summarizePromptAssembly returns stable ordering and totals', () => {
  const sections = [
    createPromptSection({
      id: 'later',
      label: 'Later',
      target: 'system',
      lifecycle: 'pinned',
      source: 'test',
      content: 'bbbb',
      order: 20,
    }),
    createPromptSection({
      id: 'first',
      label: 'First',
      target: 'system',
      lifecycle: 'pinned',
      source: 'test',
      content: 'aa',
      order: 10,
    }),
  ];

  const summary = summarizePromptAssembly(sections);

  assert.deepEqual(summary.sections.map(section => section.id), ['first', 'later']);
  assert.equal(summary.totals.chars, 6);
  assert.equal(summary.totals.sentToModelChars, 6);
});
```

- [ ] **Step 2: Run the new test to verify RED**

Run:

```bash
node --test server/agent/promptAssembly/promptAssembly.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `promptAssembly.js`.

- [ ] **Step 3: Implement prompt assembly helpers**

Create `server/agent/promptAssembly/promptAssembly.js`:

```js
export function createPromptSection({
  id,
  label,
  target,
  lifecycle,
  source,
  content = '',
  order = 100,
  sentToModel = true,
  cacheImpact = 'stable',
  metadata = {},
} = {}) {
  const normalizedContent = String(content ?? '');
  return {
    id: String(id || '').trim(),
    label: String(label || id || '').trim(),
    target: String(target || 'system').trim(),
    lifecycle: String(lifecycle || 'pinned').trim(),
    source: String(source || '').trim(),
    content: normalizedContent,
    order: Number.isFinite(order) ? order : 100,
    sentToModel: sentToModel !== false,
    cacheImpact: String(cacheImpact || 'stable').trim(),
    chars: normalizedContent.length,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {},
  };
}

export function appendSystemPromptSection(context, sectionInput) {
  if (!context || !sectionInput?.content) return;
  const section = createPromptSection(sectionInput);
  context.promptAssemblySections = Array.isArray(context.promptAssemblySections)
    ? context.promptAssemblySections
    : [];
  if (context.promptAssemblySections.some(item => item.id === section.id)) return;

  context.systemPrompt = context.systemPrompt
    ? `${context.systemPrompt}\n\n${section.content}`
    : section.content;
  context.promptAssemblySections.push(section);
}

export function composeSystemPromptSections({
  agentGuidance = '',
  guidanceFile = '',
  runtimeContext = '',
} = {}) {
  const sections = [];
  const guidanceText = String(agentGuidance || '');
  const runtimeText = String(runtimeContext || '');

  if (guidanceText) {
    sections.push(createPromptSection({
      id: 'agent_guidance',
      label: 'AGENTS.md',
      target: 'system',
      lifecycle: 'pinned',
      source: guidanceFile || 'legacy:systemPrompt',
      content: guidanceText,
      order: 10,
      cacheImpact: 'stable_until_guidance_changes',
    }));
  }

  if (runtimeText) {
    sections.push(createPromptSection({
      id: 'runtime_context',
      label: 'Runtime Context',
      target: 'system',
      lifecycle: 'pinned',
      source: 'runtime',
      content: runtimeText,
      order: 20,
      cacheImpact: 'changes_daily_or_environment',
    }));
  }

  return {
    text: sections.map(section => section.content).join('\n\n'),
    sections,
  };
}

export function summarizePromptAssembly(sections = []) {
  const normalized = (Array.isArray(sections) ? sections : [])
    .map(createPromptSection)
    .filter(section => section.id)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return {
    sections: normalized,
    totals: {
      chars: normalized.reduce((sum, section) => sum + section.chars, 0),
      sentToModelChars: normalized
        .filter(section => section.sentToModel)
        .reduce((sum, section) => sum + section.chars, 0),
    },
  };
}
```

- [ ] **Step 4: Wire base sections into runtime context composition**

Modify `server/agent/runtimeContext.js`:

```js
import { composeSystemPromptSections } from './promptAssembly/promptAssembly.js';
```

Replace `composeSystemPrompt(systemPrompt, runtimeContext)` with:

```js
export function composeSystemPrompt(systemPrompt, runtimeContext) {
  return composeSystemPromptWithSections({
    agentGuidance: systemPrompt,
    runtimeContext,
  }).text;
}

export function composeSystemPromptWithSections({
  agentGuidance = '',
  guidanceFile = '',
  runtimeContext = '',
} = {}) {
  return composeSystemPromptSections({
    agentGuidance,
    guidanceFile,
    runtimeContext,
  });
}
```

Modify `server/agent/AgentExecutor.js` constructor:

```js
import { composeSystemPromptWithSections, formatRuntimeContext, getRuntimeMetadata } from './runtimeContext.js';
```

Add a constructor parameter:

```js
guidanceFile = '',
```

Replace:

```js
const runtimeContext = formatRuntimeContext(getRuntimeMetadata());
this.systemPrompt = composeSystemPrompt(systemPrompt, runtimeContext);
```

with:

```js
this.guidanceFile = guidanceFile;
const runtimeContext = formatRuntimeContext(getRuntimeMetadata());
const composedPrompt = composeSystemPromptWithSections({
  agentGuidance: systemPrompt,
  guidanceFile,
  runtimeContext,
});
this.systemPrompt = composedPrompt.text;
this.promptAssemblySections = composedPrompt.sections;
```

- [ ] **Step 5: Update runtime context tests**

Modify `server/agent/AgentExecutor.runtimeContext.test.js` to assert the base sections exist:

```js
test('tracks base prompt assembly sections', () => {
  const executor = createExecutor({ systemPrompt: 'You are a coding assistant.' });

  assert.deepEqual(executor.promptAssemblySections.map(section => section.id), [
    'agent_guidance',
    'runtime_context',
  ]);
  assert.equal(executor.promptAssemblySections[0].target, 'system');
  assert.equal(executor.promptAssemblySections[1].source, 'runtime');
});
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```bash
node --test server/agent/promptAssembly/promptAssembly.test.js server/agent/runtimeContext.test.js server/agent/AgentExecutor.runtimeContext.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add server/agent/promptAssembly/promptAssembly.js \
  server/agent/promptAssembly/promptAssembly.test.js \
  server/agent/runtimeContext.js \
  server/agent/AgentExecutor.js \
  server/agent/AgentExecutor.runtimeContext.test.js
git commit -m "feat: track prompt assembly sections"
```

---

### Task 2: Pin Active Execution Strategy Into System Prompt

**Files:**
- Modify: `server/agent/plugins/ExecutionStrategyPlugin.js`
- Modify: `server/agent/plugins/ExecutionStrategyPlugin.test.js`
- Modify: `server/agent/strategies/strategyRegistry.test.js` only if the expected XML wrapper changes.

**Interfaces:**
- Consumes: `appendSystemPromptSection(context, section)` from Task 1.
- Produces: system sections `execution_strategy_index` and `active_execution_strategy`.
- Preserves: user-message injection only for strategy load errors.

- [ ] **Step 1: Write failing pinned strategy tests**

Add to `server/agent/plugins/ExecutionStrategyPlugin.test.js`:

```js
test('preLLM pins active strategy guideline into system prompt', async () => {
  const context = createContext({
    selectedStrategyId: 'async_teams',
    features: {
      task_orchestration: {
        enabled: true,
        strategy: 'async_teams',
        enable_agent_teams: true,
      },
    },
  });

  await ExecutionStrategyPlugin.preLLM(context);

  assert.match(context.systemPrompt, /<available_execution_strategies>/);
  assert.match(context.systemPrompt, /<active_execution_strategy id="async_teams" name="Async Agent Teams">/);
  assert.equal(
    JSON.stringify(context.apiMessages).includes('<active_execution_strategy'),
    false,
  );
  assert.deepEqual(
    context.promptAssemblySections
      .filter(section => section.id.includes('execution_strategy'))
      .map(section => ({ id: section.id, target: section.target, lifecycle: section.lifecycle })),
    [
      { id: 'execution_strategy_index', target: 'system', lifecycle: 'pinned' },
      { id: 'active_execution_strategy', target: 'system', lifecycle: 'pinned' },
    ],
  );
});

test('preLLM keeps strategy load errors in message context', async () => {
  const context = createContext({ selectedStrategyId: 'missing_strategy' });

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.systemPrompt.includes('<active_execution_strategy'), false);
  assert.equal(JSON.stringify(context.apiMessages).includes('<execution_strategy_error>'), true);
});
```

Ensure `createContext()` in the same test file includes:

```js
promptAssemblySections: [],
```

- [ ] **Step 2: Run strategy tests to verify RED**

Run:

```bash
node --test server/agent/plugins/ExecutionStrategyPlugin.test.js
```

Expected: FAIL because active strategy still appears in `apiMessages` and no `active_execution_strategy` section is recorded.

- [ ] **Step 3: Implement pinned strategy injection**

Modify `server/agent/plugins/ExecutionStrategyPlugin.js`:

```js
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';
```

Replace the strategy index append:

```js
context.systemPrompt += `\n\n${buildStrategyIndexBlock(strategies)}`;
```

with:

```js
appendSystemPromptSection(context, {
  id: 'execution_strategy_index',
  label: 'Available Execution Strategies',
  target: 'system',
  lifecycle: 'pinned',
  source: 'strategyRegistry:list',
  content: buildStrategyIndexBlock(strategies),
  order: 30,
  cacheImpact: 'stable_until_strategy_catalog_changes',
});
```

Replace the final `appendTextContext(apiMessages, strategyContext);` with:

```js
appendSystemPromptSection(context, {
  id: 'active_execution_strategy',
  label: 'Active Execution Strategy',
  target: 'system',
  lifecycle: 'pinned',
  source: `strategy:${strategy.id}`,
  content: strategyContext,
  order: 40,
  cacheImpact: 'stable_until_selected_strategy_changes',
  metadata: {
    strategyId: strategy.id,
    strategyName: strategy.name,
    override: !!guidelineOverride,
  },
});
```

Keep `appendTextContext()` for `<execution_strategy_error>` only.

- [ ] **Step 4: Run strategy tests to verify GREEN**

Run:

```bash
node --test server/agent/plugins/ExecutionStrategyPlugin.test.js server/agent/strategies/strategyRegistry.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add server/agent/plugins/ExecutionStrategyPlugin.js \
  server/agent/plugins/ExecutionStrategyPlugin.test.js \
  server/agent/strategies/strategyRegistry.test.js
git commit -m "feat: pin active execution strategy in system prompt"
```

---

### Task 3: Fast Static Dry-Run For Context Inspection

**Files:**
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/agent/plugins/MemoryPlugin.js`
- Modify: `server/agent/plugins/MemoryPlugin.test.js`
- Modify: `server/routes/harnessRoutes.test.js`

**Interfaces:**
- Produces: `executor.dryRunMode`, with MVP value `'static_context'`.
- Produces: `isStaticContextInspection(executor): boolean`.
- Dry-run request accepts `dryRunMode: 'static_context'`.
- Static context inspection skips concrete memory side-query and does not call an LLM.

- [ ] **Step 1: Write failing MemoryPlugin static inspection test**

Add to `server/agent/plugins/MemoryPlugin.test.js`:

```js
test('static context inspection injects memory index but skips memory side-query', async () => {
  let selectCalled = false;
  const context = createMemoryContext({
    dryRunMode: 'static_context',
    memoryIndex: '- [stable](stable.md) — Stable memory',
    selectAndLoadMemories: async () => {
      selectCalled = true;
      return ['should not be selected'];
    },
  });

  await MemoryPlugin.preLLM(context);

  assert.equal(selectCalled, false);
  assert.match(context.systemPrompt, /<memory_index>/);
  assert.equal(JSON.stringify(context.apiMessages).includes('<memory_context>'), false);
  assert.equal(
    context.promptAssemblySections.some(section => section.id === 'memory_index'),
    true,
  );
});
```

If the current test helper does not support injected `memoryIndex` or `selectAndLoadMemories`, first extend the helper with dependency injection:

```js
function createMemoryContext({
  dryRunMode = '',
  memoryIndex = '',
  selectAndLoadMemories = async () => [],
} = {}) {
  return {
    executor: {
      harnessId: 'h1',
      dryRunMode,
      features: { enable_memory: { enabled: true } },
      messages: [{ role: 'user', content: 'hello' }],
      onEvent: () => {},
      _callLLMNonStream: async () => {
        throw new Error('LLM should not be called in static context inspection');
      },
      memoryDependencies: {
        readIndex: async () => memoryIndex,
        selectAndLoadMemories,
      },
    },
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    systemPrompt: '',
    promptAssemblySections: [],
  };
}
```

- [ ] **Step 2: Write failing dry-run route test**

Add to `server/routes/harnessRoutes.test.js`:

```js
test('harness dry-run static context mode avoids LLM-backed memory selection', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');

  class FailingSummaryExecutor extends AgentExecutor {
    async _callLLMNonStream() {
      throw new Error('static context dry-run must not call LLM');
    }
  }

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
    ExecutorClass: FailingSummaryExecutor,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      dryRunMode: 'static_context',
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      tools: ['bash'],
      features: {
        enable_memory: { enabled: true },
      },
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.promptAssembly.sections.some(section => section.id === 'memory_context'), false);
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```bash
node --test server/agent/plugins/MemoryPlugin.test.js server/routes/harnessRoutes.test.js
```

Expected: FAIL because dry-run has no `dryRunMode` and memory side-query is not skipped.

- [ ] **Step 4: Implement static context inspection mode**

Modify `server/agent/AgentExecutor.js` constructor parameters:

```js
dryRunMode = '',
memoryDependencies = null,
```

Assign:

```js
this.dryRunMode = dryRunMode;
this.memoryDependencies = memoryDependencies;
```

Modify `server/routes/harnessRoutes.js` dry-run body destructuring:

```js
dryRunMode,
```

Pass into `new ExecutorClass`:

```js
dryRunMode: dryRunMode === 'static_context' ? 'static_context' : '',
```

Modify `server/agent/plugins/MemoryPlugin.js`:

```js
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';
```

Add:

```js
export function isStaticContextInspection(executor) {
  return executor?.dryRunMode === 'static_context';
}
```

Replace direct `readIndex(harnessId)` with:

```js
const readIndexFn = executor.memoryDependencies?.readIndex || readIndex;
const index = await readIndexFn(harnessId);
```

When injecting memory index, use:

```js
appendSystemPromptSection(context, {
  id: 'memory_index',
  label: 'Memory Index',
  target: 'system',
  lifecycle: 'pinned',
  source: `.memory/${harnessId}/MEMORY.md`,
  content: `<memory_index>\n以下是可用的长期记忆清单（具体内容已按需自动注入到本轮对话）：\n\n${index}\n</memory_index>`,
  order: 80,
  cacheImpact: 'stable_until_memory_index_changes',
});
```

Before `selectAndLoadMemories`:

```js
if (isStaticContextInspection(executor)) return;
```

For tests, use:

```js
const selectAndLoadMemoriesFn = executor.memoryDependencies?.selectAndLoadMemories || selectAndLoadMemories;
const memoryContents = await selectAndLoadMemoriesFn(callLLM, harnessId, recentMessages);
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```bash
node --test server/agent/plugins/MemoryPlugin.test.js server/routes/harnessRoutes.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/agent/AgentExecutor.js \
  server/routes/harnessRoutes.js \
  server/routes/harnessRoutes.test.js \
  server/agent/plugins/MemoryPlugin.js \
  server/agent/plugins/MemoryPlugin.test.js
git commit -m "perf: make context inspector dry-run static"
```

---

### Task 4: Prompt Assembly Metadata In Dry-Run Response

**Files:**
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/routes/harnessRoutes.test.js`
- Modify: `server/agent/plugins/SkillsPlugin.js`
- Modify: `server/agent/plugins/TaskSystemPlugin.js`
- Modify: `server/agent/plugins/TodoNagPlugin.js`
- Modify: corresponding plugin tests if assertions depend on raw prompt append.

**Interfaces:**
- Consumes: `appendSystemPromptSection(context, section)` and `summarizePromptAssembly(sections)`.
- Produces dry-run response:

```js
{
  system,
  tools,
  messages,
  promptAssembly: {
    sections: [
      {
        id,
        label,
        target,
        lifecycle,
        source,
        sentToModel,
        cacheImpact,
        chars,
        content,
        order,
        metadata
      }
    ],
    totals: {
      chars,
      sentToModelChars
    }
  }
}
```

- [ ] **Step 1: Write failing dry-run assembly response test**

Add to `server/routes/harnessRoutes.test.js`:

```js
test('harness dry-run returns prompt assembly sections for sent model context only', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      dryRunMode: 'static_context',
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      systemPrompt: 'You are helpful.',
      tools: ['bash'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          strategy: 'async_teams',
          enable_agent_teams: true,
        },
      },
      selectedStrategyId: 'async_teams',
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.promptAssembly.sections.map(section => section.id).filter(id => [
      'agent_guidance',
      'runtime_context',
      'execution_strategy_index',
      'active_execution_strategy',
      'todo_guidelines',
    ].includes(id)),
    [
      'agent_guidance',
      'runtime_context',
      'execution_strategy_index',
      'active_execution_strategy',
      'todo_guidelines',
    ],
  );
  assert.equal(res.body.promptAssembly.sections.every(section => section.sentToModel), true);
  assert.equal('runtimeNotificationSummary' in res.body, false);
  assert.equal('memoryCandidateSummary' in res.body, false);
});
```

- [ ] **Step 2: Run dry-run test to verify RED**

Run:

```bash
node --test server/routes/harnessRoutes.test.js
```

Expected: FAIL because `promptAssembly` is missing and sidecar summaries are still returned.

- [ ] **Step 3: Convert system prompt plugin appends to assembly sections**

Modify `server/agent/plugins/SkillsPlugin.js`:

```js
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';
```

Replace:

```js
context.systemPrompt += skillsPrompt;
```

with:

```js
appendSystemPromptSection(context, {
  id: 'available_skills',
  label: 'Available Skills',
  target: 'system',
  lifecycle: 'pinned',
  source: 'skills',
  content: skillsPrompt.trim(),
  order: 60,
  cacheImpact: 'stable_until_skill_selection_changes',
  metadata: { count: richSkills.length },
});
```

Modify `server/agent/plugins/TaskSystemPlugin.js`:

```js
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';
```

Replace task guideline append with:

```js
appendSystemPromptSection(context, {
  id: 'task_system_guidelines',
  label: 'Task System Guidelines',
  target: 'system',
  lifecycle: 'pinned',
  source: 'feature:task_orchestration.task_system_prompt',
  content: promptToInject,
  order: 70,
  cacheImpact: 'stable_until_feature_prompt_changes',
});
```

Replace task dependency graph append with:

```js
appendSystemPromptSection(context, {
  id: 'task_dependency_graph',
  label: 'Task Dependency Graph',
  target: 'system',
  lifecycle: 'pinned',
  source: `_tasks/${harnessId}`,
  content: staticSection.trim(),
  order: 90,
  cacheImpact: 'changes_when_task_graph_changes',
  metadata: { count: tasks.length },
});
```

Modify `server/agent/plugins/TodoNagPlugin.js`:

```js
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';
```

Replace todo guideline append with:

```js
appendSystemPromptSection(context, {
  id: 'todo_guidelines',
  label: 'Todo Guidelines',
  target: 'system',
  lifecycle: 'pinned',
  source: 'feature:task_orchestration.todo_prompt',
  content: promptToInject,
  order: 70,
  cacheImpact: 'stable_until_feature_prompt_changes',
});
```

Leave dynamic todo/task status injection in `apiMessages`; it is visible in Messages Payload rather than system assembly.

- [ ] **Step 4: Return promptAssembly from dry-run and remove sidecar summaries**

Modify `server/routes/harnessRoutes.js` imports:

```js
import { summarizePromptAssembly } from '../agent/promptAssembly/promptAssembly.js';
```

In dry-run context creation, add:

```js
promptAssemblySections: [...(executor.promptAssemblySections || [])],
```

After hooks, before `res.json`, compute:

```js
const promptAssembly = summarizePromptAssembly(context.promptAssemblySections || []);
```

Return:

```js
res.json({
  system: aligned.system,
  tools: aligned.tools,
  messages: aligned.messages,
  promptAssembly,
});
```

Remove default response fields from Context Inspector dry-run response:

```js
toolPoolSummary
runtimeNotificationSummary
memoryCandidateSummary
```

If other tests still rely on those fields, keep them only when body contains:

```js
includeDebugSummaries: true
```

and update existing tests to pass `includeDebugSummaries: true`.

- [ ] **Step 5: Update tests that still expect debug summaries**

In existing tests:

```js
harness dry-run returns compact tool pool summary from runtime tools
harness dry-run reports notification summary without consuming the live queue
harness dry-run reports memory candidate summary without loading full candidate bodies
```

Add request body field:

```js
includeDebugSummaries: true,
```

This keeps backwards test coverage for debug summaries without showing them in the default Context Inspector response.

- [ ] **Step 6: Run backend tests to verify GREEN**

Run:

```bash
node --test server/routes/harnessRoutes.test.js \
  server/agent/plugins/ExecutionStrategyPlugin.test.js \
  server/agent/plugins/TaskSystemPlugin.test.js \
  server/agent/plugins/MemoryPlugin.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add server/routes/harnessRoutes.js \
  server/routes/harnessRoutes.test.js \
  server/agent/plugins/SkillsPlugin.js \
  server/agent/plugins/TaskSystemPlugin.js \
  server/agent/plugins/TodoNagPlugin.js \
  server/agent/plugins/MemoryPlugin.js \
  server/agent/plugins/ExecutionStrategyPlugin.js \
  server/agent/plugins/*.test.js
git commit -m "feat: return prompt assembly metadata from dry-run"
```

---

### Task 5: Split Context Inspector UI

**Files:**
- Create: `src/lib/contextInspectorModel.js`
- Create: `src/lib/contextInspectorModel.test.js`
- Modify: `src/components/ContextInspector.jsx`

**Interfaces:**
- Consumes dry-run response fields: `promptAssembly`, `system`, `messages`, `tools`.
- Produces UI model:

```js
{
  groups: [
    {
      id: 'system',
      label: 'System Prompt',
      rows: [
        {
          id,
          label,
          subtitle,
          target,
          lifecycle,
          chars,
          content,
          kind: 'prompt_section'
        }
      ]
    },
    {
      id: 'messages',
      label: 'Messages Payload',
      rows: [...]
    },
    {
      id: 'tools',
      label: 'Provider Tool Schema',
      rows: [...]
    }
  ],
  defaultSelectionId
}
```

- [ ] **Step 1: Write failing UI model tests**

Create `src/lib/contextInspectorModel.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContextInspectorModel,
  formatContextSize,
} from './contextInspectorModel.js';

test('buildContextInspectorModel groups sent model context only', () => {
  const model = buildContextInspectorModel({
    promptAssembly: {
      sections: [
        {
          id: 'agent_guidance',
          label: 'AGENTS.md',
          target: 'system',
          lifecycle: 'pinned',
          source: 'guidance/h1/AGENTS.md',
          content: 'You are helpful.',
          chars: 16,
          sentToModel: true,
        },
        {
          id: 'memory_candidate_queue',
          label: 'Memory Candidates',
          target: 'sidecar',
          lifecycle: 'queue',
          source: '.memory/h1/_candidates',
          content: 'not sent',
          chars: 8,
          sentToModel: false,
        },
      ],
    },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ],
    tools: [
      { name: 'bash', description: 'Run shell', input_schema: { type: 'object' } },
    ],
  });

  assert.deepEqual(model.groups.map(group => group.id), ['system', 'messages', 'tools']);
  assert.deepEqual(model.groups[0].rows.map(row => row.id), ['agent_guidance']);
  assert.equal(JSON.stringify(model).includes('memory_candidate_queue'), false);
  assert.equal(model.defaultSelectionId, 'agent_guidance');
});

test('formatContextSize uses compact readable labels', () => {
  assert.equal(formatContextSize(999), '999 chars');
  assert.equal(formatContextSize(1536), '1.5k chars');
});
```

- [ ] **Step 2: Run UI model tests to verify RED**

Run:

```bash
node --test src/lib/contextInspectorModel.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement UI model helper**

Create `src/lib/contextInspectorModel.js`:

```js
export function formatContextSize(chars = 0) {
  const value = Number(chars) || 0;
  if (value < 1000) return `${value} chars`;
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k chars`;
}

function getBlockText(block) {
  if (typeof block?.text === 'string') return block.text;
  if (typeof block?.content === 'string') return block.content;
  if (typeof block?.thinking === 'string') return block.thinking;
  return JSON.stringify(block ?? {}, null, 2);
}

function createMessageRow(message, index) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content || '') }];
  const content = blocks.map((block, blockIndex) => {
    const type = block?.type || 'unknown';
    return `#${blockIndex + 1} ${type}\n${getBlockText(block)}`;
  }).join('\n\n');

  return {
    id: `message_${index}`,
    label: `${message.role || 'message'} #${index + 1}`,
    subtitle: `${blocks.length} block(s) · ${formatContextSize(content.length)}`,
    target: 'messages',
    lifecycle: 'payload',
    chars: content.length,
    content,
    kind: 'message',
  };
}

function createToolRow(tool, index) {
  const content = JSON.stringify(tool, null, 2);
  return {
    id: `tool_${tool?.name || index}`,
    label: tool?.name || `tool #${index + 1}`,
    subtitle: formatContextSize(content.length),
    target: 'tools',
    lifecycle: 'provider_schema',
    chars: content.length,
    content,
    kind: 'tool_schema',
  };
}

export function buildContextInspectorModel({
  promptAssembly = {},
  messages = [],
  tools = [],
} = {}) {
  const systemRows = (promptAssembly.sections || [])
    .filter(section => section?.sentToModel !== false && section?.target === 'system')
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(section => ({
      id: section.id,
      label: section.label || section.id,
      subtitle: `${section.source || 'unknown'} · ${section.lifecycle || 'pinned'} · ${formatContextSize(section.chars || section.content?.length || 0)}`,
      target: section.target,
      lifecycle: section.lifecycle || 'pinned',
      chars: section.chars || String(section.content || '').length,
      content: section.content || '',
      kind: 'prompt_section',
      cacheImpact: section.cacheImpact || '',
    }));

  const messageRows = (messages || []).map(createMessageRow);
  const toolRows = (tools || []).map(createToolRow);

  const groups = [
    { id: 'system', label: 'System Prompt', rows: systemRows },
    { id: 'messages', label: 'Messages Payload', rows: messageRows },
    { id: 'tools', label: 'Provider Tool Schema', rows: toolRows },
  ];

  const firstRow = groups.flatMap(group => group.rows)[0] || null;

  return {
    groups,
    defaultSelectionId: firstRow?.id || '',
  };
}
```

- [ ] **Step 4: Run UI model tests to verify GREEN**

Run:

```bash
node --test src/lib/contextInspectorModel.test.js
```

Expected: PASS.

- [ ] **Step 5: Refactor ContextInspector JSX to split view**

Modify `src/components/ContextInspector.jsx`:

```js
import { buildContextInspectorModel } from '../lib/contextInspectorModel.js';
```

Add state:

```js
const [selectedSectionId, setSelectedSectionId] = useState('');
```

After aligned data arrives:

```js
.then(data => {
  setAlignedData(data);
  const nextModel = buildContextInspectorModel(data);
  setSelectedSectionId(prev => prev || nextModel.defaultSelectionId);
  setLoading(false);
})
```

Change dry-run body to include:

```js
dryRunMode: 'static_context',
```

Remove calls/rendering for:

```js
renderToolPoolSummary()
renderRuntimeNotificationSummary()
renderMemoryCandidateSummary()
renderStrategySummary()
```

Replace the main content after loading with:

```jsx
const inspectorModel = buildContextInspectorModel(alignedData);
const rows = inspectorModel.groups.flatMap(group => group.rows);
const selectedRow = rows.find(row => row.id === selectedSectionId) || rows[0];
```

Render:

```jsx
<div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', minHeight: 0, height: '100%' }}>
  <aside style={{ borderRight: '1px solid var(--border)', overflow: 'auto', padding: 12 }}>
    {inspectorModel.groups.map(group => (
      <div key={group.id} style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>
          {group.label} · {group.rows.length}
        </div>
        {group.rows.map(row => (
          <button
            key={row.id}
            onClick={() => setSelectedSectionId(row.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              display: 'block',
              padding: '9px 10px',
              marginBottom: 6,
              borderRadius: 6,
              border: selectedRow?.id === row.id ? '1px solid var(--blue)' : '1px solid var(--border)',
              background: selectedRow?.id === row.id ? 'rgba(59, 130, 246, 0.10)' : 'var(--bg-surface)',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 3 }}>{row.label}</div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.subtitle}</div>
          </button>
        ))}
      </div>
    ))}
  </aside>
  <section style={{ minWidth: 0, overflow: 'auto', padding: 16 }}>
    {selectedRow ? (
      <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{selectedRow.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{selectedRow.target} · {selectedRow.lifecycle} · {selectedRow.subtitle}</div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => navigator.clipboard.writeText(selectedRow.content || '')}
            style={{ padding: '5px 10px', fontSize: 11 }}
          >
            Copy Section
          </button>
        </div>
        <pre style={{ margin: 0, padding: 14, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflow: 'auto' }}>
          {selectedRow.content || '(empty)'}
        </pre>
      </>
    ) : (
      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No context sections available.</div>
    )}
  </section>
</div>
```

Keep the bottom button for copying full payload:

```js
navigator.clipboard.writeText(JSON.stringify({
  system: alignedData.system || '',
  messages: alignedData.messages || [],
  tools: alignedData.tools || [],
}, null, 2));
```

- [ ] **Step 6: Run frontend tests and build**

Run:

```bash
node --test src/lib/contextInspectorModel.test.js
npm run build
```

Expected: PASS and Vite build succeeds.

- [ ] **Step 7: Commit Task 5**

```bash
git add src/lib/contextInspectorModel.js \
  src/lib/contextInspectorModel.test.js \
  src/components/ContextInspector.jsx
git commit -m "ui: simplify context inspector assembly view"
```

---

### Task 6: Roadmap Update And Full Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md`
- Modify: `docs/superpowers/plans/2026-07-04-context-assembly-inspector.md` if implementation reveals a naming mismatch.

**Interfaces:**
- Stage 5 task sequence becomes:
  - Task 11: Automatic Memory Quality Gate
  - Task 12: AGENTS.md Explicit Guidance
  - Task 13: Pinned Strategy + Context Assembly Inspector
  - Task 14: Multi-layer Guidance Composition
  - Task 15: Mountable Knowledge Bases
  - Task 16: Runtime Resource Mount Registry

- [ ] **Step 1: Update consolidated roadmap Stage 5**

Replace the Stage 5 section in `docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md` with a concise Stage 5 overview that includes:

```md
## Stage 5: Context & Knowledge Layer

### Task 11: Automatic Memory Quality Gate

Status: Completed.

### Task 12: AGENTS.md Explicit Guidance

Status: Completed.

### Task 13: Pinned Strategy + Context Assembly Inspector

Goal: Make Context Inspector a fast, clear view of exactly what the current model request receives.

### Task 14: Multi-layer Guidance Composition

Goal: Add project-level guidance composition on top of harness-level AGENTS.md.

### Task 15: Mountable Knowledge Bases

Goal: Let users upload files, create reusable local knowledge bases, and mount selected bases into a conversation.

### Task 16: Runtime Resource Mount Registry

Goal: Create one registry for future mountable runtime resources after guidance and knowledge mounting stabilize.
```

Keep the original detailed Task 11 note. Move the existing Knowledge Bases and Runtime Resource Mount Registry details under Task 15 and Task 16, updating only their task numbers and stage title.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run build
```

Expected:

```text
tests pass
✓ built
```

- [ ] **Step 3: Check git status for unrelated files**

Run:

```bash
git status --short
```

Expected: only Task 13 files are staged or modified for this work. Do not stage unrelated harness or docs files.

- [ ] **Step 4: Commit Task 6**

```bash
git add docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md \
  docs/superpowers/plans/2026-07-04-context-assembly-inspector.md
git commit -m "docs: plan context assembly inspector"
```

---

## Manual Acceptance Tests

After implementation, run the app and test:

1. Open a harness with task orchestration enabled.
2. Open Context Inspector.
3. Confirm the modal loads quickly without visible model-call delay.
4. Confirm the left rail shows only:
   - System Prompt
   - Messages Payload
   - Provider Tool Schema
5. Confirm it does not show default cards for:
   - Runtime Tool Pool
   - Runtime Notifications
   - Memory Candidates
6. Confirm `active_execution_strategy` appears under System Prompt, not latest user message.
7. Confirm each section can be clicked and displays complete content on the right.
8. Confirm full payload copy includes `system`, `messages`, and `tools`.

## Self-Review

- Spec coverage: The plan covers pinned strategy injection, static dry-run performance, prompt assembly metadata, removal of sidecar dashboard sections, full section inspection, UI redesign, roadmap renumbering, and full verification.
- Placeholder scan: No placeholder markers or unspecified implementation steps remain.
- Type consistency: The plan consistently uses `PromptAssemblySection`, `promptAssembly.sections`, `dryRunMode: 'static_context'`, and `appendSystemPromptSection`.
