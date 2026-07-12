# Resizable Workbench Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Harness Explorer and the Trajectory configuration panel independent, persistent resize and collapse behavior so the agent trajectory can use the available workspace.

**Architecture:** A pure `workbenchPanelState` module normalizes browser-local state and focus restoration without knowing React. `ResizableWorkbenchPanel` owns pointer capture, drag cleanup, and the expanded/collapsed presentation. `App.jsx` and `TrajectoryPage.jsx` each own one panel record; `TrajectoryView` only receives the focus action and state.

**Tech Stack:** React 19, CSS custom properties, Pointer Events, `localStorage`, Lucide React, `node:test`, Vite.

## Global Constraints

- Harness Explorer defaults to 272px and clamps to 216px–420px.
- Trajectory configuration defaults to 340px and clamps to 280px–480px.
- Collapsed rails are exactly 42px wide.
- Persist only `{ width, collapsed }` in versioned browser-local keys; do not modify Harness JSON or server APIs.
- Persist width on pointer release, never on every pointer move.
- Do not re-mount `TrajectoryView`, `ConfigPanel`, or the agent loop while the user resizes.
- Keep current narrow-screen behavior; desktop panel rails do not appear below the existing responsive breakpoint.

---

### Task 1: Persistent Workbench Panel State

**Files:**
- Create: `src/lib/workbenchPanelState.js`
- Create: `src/lib/workbenchPanelState.test.js`

**Interfaces:**
- Produces: `normalizeWorkbenchPanelState(value, defaults)`.
- Produces: `loadWorkbenchPanelState(storage, key, defaults)`.
- Produces: `saveWorkbenchPanelState(storage, key, state, defaults)`.
- Produces: `toggleWorkbenchPanel(state)` and focus helpers `enterWorkbenchFocus(panels)` / `restoreWorkbenchFocus(panels, focusSnapshot)`.

- [ ] **Step 1: Write failing state tests**

```js
test('normalizes invalid widths and preserves collapsed state', () => {
  assert.deepEqual(
    normalizeWorkbenchPanelState({ width: 999, collapsed: true }, defaults),
    { width: 420, collapsed: true },
  );
});

test('loads malformed browser storage as defaults', () => {
  assert.deepEqual(loadWorkbenchPanelState(storage, key, defaults), defaults);
});

test('focus snapshots restore only panels collapsed by focus mode', () => {
  const focused = enterWorkbenchFocus({ explorer, config });
  assert.equal(focused.panels.explorer.collapsed, true);
  assert.equal(restoreWorkbenchFocus(focused.panels, focused.snapshot).config.collapsed, false);
});
```

- [ ] **Step 2: Run the test file and verify it fails**

Run: `node --test src/lib/workbenchPanelState.test.js`

Expected: module-not-found failure for `workbenchPanelState.js`.

- [ ] **Step 3: Implement the pure helpers**

```js
export function normalizeWorkbenchPanelState(value, defaults) {
  const width = Number(value?.width);
  return {
    width: Number.isFinite(width)
      ? Math.max(defaults.minWidth, Math.min(defaults.maxWidth, width))
      : defaults.width,
    collapsed: Boolean(value?.collapsed),
  };
}

export function enterWorkbenchFocus(panels) {
  return {
    panels: Object.fromEntries(Object.entries(panels).map(([key, panel]) => [key, { ...panel, collapsed: true }])),
    snapshot: Object.fromEntries(Object.entries(panels).map(([key, panel]) => [key, panel.collapsed])),
  };
}
```

Use `try/catch` inside storage functions. `saveWorkbenchPanelState` writes only normalized `width` and `collapsed` values and returns the persisted state even if storage is unavailable.

- [ ] **Step 4: Run focused tests**

Run: `node --test src/lib/workbenchPanelState.test.js`

Expected: all panel-state tests pass.

- [ ] **Step 5: Commit the state layer**

```bash
git add src/lib/workbenchPanelState.js src/lib/workbenchPanelState.test.js
git commit -m "feat: add persistent workbench panel state"
```

### Task 2: Shared Resizable And Collapsible Panel Component

**Files:**
- Create: `src/components/ResizableWorkbenchPanel.jsx`
- Modify: `src/App.css`
- Test: `src/lib/workbenchPanelState.test.js`

**Interfaces:**
- Consumes: `{ id, label, icon, panel, minWidth, maxWidth, onPanelChange, onPanelCommit, children }`.
- Produces: a stable expanded panel wrapper, 42px collapsed rail, and pointer-driven divider.

- [ ] **Step 1: Extend the failing test with width clamping used by dragging**

```js
test('normalizes a pointer-derived width at both resize bounds', () => {
  assert.equal(normalizeWorkbenchPanelState({ width: 100 }, defaults).width, defaults.minWidth);
  assert.equal(normalizeWorkbenchPanelState({ width: 999 }, defaults).width, defaults.maxWidth);
});
```

- [ ] **Step 2: Run the focused tests**

Run: `node --test src/lib/workbenchPanelState.test.js`

Expected: the new boundary assertion fails until the state helper is complete.

- [ ] **Step 3: Implement `ResizableWorkbenchPanel`**

```jsx
<aside className="workbench-panel" style={{ width: panel.collapsed ? 42 : panel.width }}>
  {panel.collapsed ? <CollapsedRail /> : children}
  {!panel.collapsed && <div className="workbench-resize-handle" onPointerDown={beginResize} />}
</aside>
```

`beginResize` captures the pointer, temporarily adds `workbench-is-resizing` to `document.body`, updates local width on pointer move through `onPanelChange`, and calls `onPanelCommit` once on pointer up or pointer cancel. Cleanup releases pointer capture and removes listeners/classes on unmount. Header and rail controls use Lucide `PanelLeftClose` / `PanelLeftOpen` with labels and tooltips.

- [ ] **Step 4: Add CSS for the desktop workbench interaction**

Add `.workbench-panel`, `.workbench-panel-rail`, `.workbench-resize-handle`, and `.workbench-is-resizing` styles. The handle has a 7px hit target with a 1px visual divider, becomes blue while active, and never changes the page's vertical geometry. Keep collapsed rails at 42px and use `min-width: 0` on sibling content so the trajectory receives recovered width.

- [ ] **Step 5: Run focused state tests and production build**

Run: `node --test src/lib/workbenchPanelState.test.js && npm run build`

Expected: tests pass and Vite completes successfully.

- [ ] **Step 6: Commit the reusable panel primitive**

```bash
git add src/components/ResizableWorkbenchPanel.jsx src/App.css src/lib/workbenchPanelState.test.js
git commit -m "feat: add resizable workbench panel primitive"
```

### Task 3: Integrate Harness Explorer And Trajectory Configuration

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/pages/TrajectoryPage.jsx`
- Modify: `src/components/TrajectoryView.jsx`
- Modify: `src/App.css`

**Interfaces:**
- `App.jsx` owns `llm-space.workbench.harness-explorer.v1`.
- `TrajectoryPage.jsx` owns `llm-space.workbench.trajectory-config.v1`.
- `TrajectoryView` consumes `isFocusMode` and `onToggleFocusMode` for a toolbar control only.

- [ ] **Step 1: Add failing focus semantics tests**

```js
test('focus mode preserves an already collapsed explorer after restore', () => {
  const focused = enterWorkbenchFocus({
    explorer: { width: 272, collapsed: true },
    config: { width: 340, collapsed: false },
  });
  assert.deepEqual(restoreWorkbenchFocus(focused.panels, focused.snapshot), {
    explorer: { width: 272, collapsed: true },
    config: { width: 340, collapsed: false },
  });
});
```

- [ ] **Step 2: Run the state test file and verify the focus test fails**

Run: `node --test src/lib/workbenchPanelState.test.js`

Expected: the restore behavior fails until the helper distinguishes already-collapsed panels.

- [ ] **Step 3: Wrap Harness Explorer in `App.jsx`**

Initialize state via `loadWorkbenchPanelState(window.localStorage, 'llm-space.workbench.harness-explorer.v1', explorerDefaults)`. Render `HarnessExplorer` as the child of `ResizableWorkbenchPanel`; call `saveWorkbenchPanelState` on commit. Keep `main-content` as a `min-width: 0` flex sibling so route content grows into reclaimed space.

- [ ] **Step 4: Wrap ConfigPanel in `TrajectoryPage.jsx`**

Initialize independent config state under `llm-space.workbench.trajectory-config.v1`. Wrap `ConfigPanel` with the same primitive. Do not key or conditionally re-create `TrajectoryView` while panel state changes.

- [ ] **Step 5: Add focus control to `TrajectoryView.jsx`**

Use Lucide `Focus` / `PanelLeftOpen` to add an icon-only action in the existing trajectory toolbar. Pass a callback back to `TrajectoryPage` that changes both panel states with `enterWorkbenchFocus`, stores a focus snapshot, and restores it using `restoreWorkbenchFocus`. If either panel is manually changed while focused, discard the snapshot and exit focus mode.

- [ ] **Step 6: Run integration checks**

Run: `node --test src/lib/workbenchPanelState.test.js && npm run build && git diff --check`

Expected: tests pass, Vite builds, and there is no whitespace error.

- [ ] **Step 7: Commit integration**

```bash
git add src/App.jsx src/pages/TrajectoryPage.jsx src/components/TrajectoryView.jsx src/App.css src/lib/workbenchPanelState.test.js
git commit -m "feat: add resizable trajectory workbench panels"
```

### Task 4: Verification And Documentation Closeout

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-resizable-workbench-panels-design.md`
- Modify: `docs/superpowers/plans/2026-07-12-resizable-workbench-panels.md`

**Interfaces:**
- No production interface changes.

- [ ] **Step 1: Mark implemented requirements and manual verification status**

Add an implementation status note to the design and check off automated work in this plan. Keep the manual visual acceptance item explicitly pending if browser automation remains blocked by host policy.

- [ ] **Step 2: Run full verification**

Run: `npm test && npm run build && git diff --check`

Expected: all tests pass, the production build completes, and the diff check is clean.

- [ ] **Step 3: Perform manual desktop acceptance**

Verify at desktop width:

1. Drag each panel to both bounds and observe the trajectory resize without losing its transcript.
2. Collapse and restore each panel; verify each rail is 42px and has a tooltip.
3. Refresh, switch Harnesses, and confirm layout state persists.
4. Use focus mode, then restore; verify a panel already collapsed before focus remains collapsed afterward.
5. Start an agent run, resize/collapse panels during streamed output, and confirm no message or input state resets.

- [ ] **Step 4: Commit closeout documentation**

```bash
git add docs/superpowers/specs/2026-07-12-resizable-workbench-panels-design.md docs/superpowers/plans/2026-07-12-resizable-workbench-panels.md
git commit -m "docs: close resizable workbench panels"
```
