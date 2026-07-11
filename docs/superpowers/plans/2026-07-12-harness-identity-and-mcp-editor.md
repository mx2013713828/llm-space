# Harness Identity And MCP Editor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate Harness display identity from storage filenames and make MCP create/edit a focused, mutually exclusive right-pane state.

**Architecture:** `server/harnessIdentity.js` owns persisted identity and filename rules; the Harness routes expose `name` and `filename` distinctly. A small frontend presentation module and shared component render identical Harness identity across Explorer, Knowledge, and MCP. MCP editor mode is represented by a pure state helper so detail/create/edit transitions can be tested without rendering the full page.

**Tech Stack:** Node.js ESM, Express route tests, React, Lucide icons, CSS, `node:test`, Vite.

## Global Constraints

- Harness `id` is immutable after creation.
- Harness `name` is editable display text and never represents a filename.
- Existing physical Harness JSON filenames are not renamed.
- Existing ID-keyed sessions, guidance, memory, tasks, Knowledge mounts, and MCP mounts are not migrated.
- Long Harness names remain one line with ellipsis and a full-value tooltip.
- MCP create/edit replaces the right detail pane; it is never stacked above server detail.

---

### Task 1: Harness Identity And Route Contract

**Files:**
- Modify: `server/harnessIdentity.js`
- Modify: `server/harnessIdentity.test.js`
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/routes/harnessRoutes.test.js`

**Interfaces:**
- Produces: `normalizeHarnessDisplayName(value): string`
- Produces: `getHarnessStorageFilename(id): string`
- Produces: `createHarnessSummary(harness, filename): { id, name, filename, description, category }`
- Changes: `createHarnessDraft()` stores display `name` and returns storage `filename` separately.

- [ ] **Step 1: Write failing identity tests**

```js
assert.equal(normalizeHarnessDisplayName('My Bot.json'), 'My Bot');
assert.equal(normalizeHarnessDisplayName('Basic Chatbot'), 'Basic Chatbot');
assert.equal(getHarnessStorageFilename('my-bot'), 'my-bot.json');

const draft = createHarnessDraft({ name: 'My Bot', existingHarnesses: [] });
assert.equal(draft.harness.name, 'My Bot');
assert.equal(draft.filename, 'my-bot.json');
```

- [ ] **Step 2: Run the focused test and confirm the old filename-in-name behavior fails**

Run: `node --test server/harnessIdentity.test.js`

Expected: FAIL because the normalization/summary functions and draft envelope do not exist.

- [ ] **Step 3: Implement identity normalization and independent storage filename generation**

`createHarnessDraft()` returns `{ harness, filename }`. `createCopiedHarnessDraft()` returns the same shape, uses a unique copied ID, and stores `${sourceDisplayName} Copy` in `harness.name`.

- [ ] **Step 4: Update Harness routes and route tests**

List responses use:

```js
createHarnessSummary(data, file)
```

Create/copy routes write `draft.harness` to `draft.filename`. Route tests assert:

```js
assert.deepEqual(list.body[0], {
  id: 'alpha',
  name: 'Alpha Harness',
  filename: 'legacy-alpha.json',
  description: 'Alpha',
  category: 'basic',
});
```

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test server/harnessIdentity.test.js server/routes/harnessRoutes.test.js`

Expected: PASS.

Commit: `refactor: separate harness identity from filenames`

---

### Task 2: Shared Harness Identity Presentation

**Files:**
- Create: `src/lib/harnessPresentation.js`
- Create: `src/lib/harnessPresentation.test.js`
- Create: `src/components/HarnessIdentity.jsx`
- Modify: `src/App.jsx`
- Modify: `src/App.css`

**Interfaces:**
- Produces: `getHarnessPresentation(harness): { id, name, primary, secondary, title }`
- Produces: `<HarnessIdentity harness compact className />`

- [ ] **Step 1: Write failing presentation tests**

```js
assert.deepEqual(getHarnessPresentation({ id: 'chat-bot', name: 'Basic Chatbot' }), {
  id: 'chat-bot',
  name: 'Basic Chatbot',
  primary: 'Basic Chatbot',
  secondary: 'chat-bot',
  title: 'Basic Chatbot (chat-bot)',
});
assert.equal(getHarnessPresentation({ id: 'legacy', name: 'Legacy.json' }).primary, 'Legacy');
assert.equal(getHarnessPresentation(null).primary, 'No harness selected');
```

- [ ] **Step 2: Run the test and verify the helper is absent**

Run: `node --test src/lib/harnessPresentation.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure helper and shared component**

The component renders fixed semantic elements for label, primary name, and monospace ID. It applies `title={presentation.title}` and leaves layout to shared CSS classes.

- [ ] **Step 4: Update Harness Explorer to use display name plus ID**

Replace direct `file.name` rendering with `<HarnessIdentity harness={file} compact />`; keep description below it. Do not show `filename` in the ordinary sidebar.

- [ ] **Step 5: Run tests/build and commit**

Run: `node --test src/lib/harnessPresentation.test.js && npm run build`

Expected: PASS.

Commit: `feat: unify harness identity presentation`

---

### Task 3: MCP Editor State Machine

**Files:**
- Create: `src/lib/mcpEditorState.js`
- Create: `src/lib/mcpEditorState.test.js`
- Modify: `src/pages/McpPage.jsx`

**Interfaces:**
- Produces: `createMcpEditorState(): { mode: 'detail', returnServerId: '' }`
- Produces: `openMcpCreate(state, selectedId)`
- Produces: `openMcpEdit(state, selectedId)`
- Produces: `closeMcpEditor(state): { mode: 'detail', returnServerId }`
- Produces: `isMcpEditorOpen(state): boolean`

- [ ] **Step 1: Write failing state transition tests**

```js
const base = createMcpEditorState();
assert.equal(openMcpCreate(base, 'echo').mode, 'create');
assert.equal(openMcpEdit(base, 'echo').returnServerId, 'echo');
assert.equal(closeMcpEditor(openMcpEdit(base, 'echo')).mode, 'detail');
assert.equal(isMcpEditorOpen(base), false);
```

- [ ] **Step 2: Run the test and verify the helper is absent**

Run: `node --test src/lib/mcpEditorState.test.js`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure state helper and replace `showForm`**

Use one `editorState` value. Add starts `create` with `EMPTY_FORM`; Edit starts `edit` with `serverToForm(selectedServer)`. Cancel restores `returnServerId`. Selecting a server closes the editor and selects that server.

- [ ] **Step 4: Make editor and detail mutually exclusive**

Render:

```jsx
{isMcpEditorOpen(editorState)
  ? <McpServerEditor ... />
  : selectedServer
    ? <McpServerDetail ... />
    : <McpEmptyState />}
```

The existing selected server detail must not be present in the DOM while editing.

- [ ] **Step 5: Run state tests/build and commit**

Run: `node --test src/lib/mcpEditorState.test.js && npm run build`

Expected: PASS.

Commit: `feat: add focused mcp editor mode`

---

### Task 4: Consistent Knowledge/MCP Harness Header And Visual QA

**Files:**
- Modify: `src/pages/KnowledgePage.jsx`
- Modify: `src/pages/McpPage.jsx`
- Modify: `src/index.css`
- Modify: `docs/superpowers/specs/2026-07-12-harness-identity-and-mcp-editor-design.md`

**Interfaces:**
- Consumes: `<HarnessIdentity harness />`
- Produces: identical current-Harness header treatment in Knowledge and MCP.

- [ ] **Step 1: Replace Knowledge and MCP direct name/ID rendering**

Both pages render:

```jsx
<HarnessIdentity harness={harness} className="workspace-harness-identity" />
```

Knowledge keeps `bases` and `formats` as metrics; Harness identity is a separate fixed-width element rather than a metric value.

- [ ] **Step 2: Implement focused editor and stable identity CSS**

Add shared one-line ellipsis rules, fixed identity dimensions, a full-height MCP editor surface, and responsive constraints that do not alter existing desktop workbench density.

- [ ] **Step 3: Run all relevant tests and build**

Run:

```bash
node --test server/harnessIdentity.test.js server/routes/harnessRoutes.test.js src/lib/harnessPresentation.test.js src/lib/mcpEditorState.test.js
npm run build
git diff --check
```

Expected: all tests and build PASS; diff check is empty.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 5: Browser visual verification**

Verify desktop screenshots for:

- MCP detail mode.
- MCP create mode with no server detail underneath.
- MCP edit mode with no server detail underneath.
- Knowledge and MCP showing the same name/ID.
- A long Harness name remaining one line without moving metrics.

- [ ] **Step 6: Mark the design implemented and commit**

Add an implementation status note to the spec.

Commit: `docs: close harness identity and mcp editor ux`
