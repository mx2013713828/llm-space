# Task 2 Report: Resizable Workbench Panel Primitive

## Status

Implemented and committed Task 2 only. The user-owned uncommitted `harnesses/02-bash.json` was preserved and was not staged.

## Changed Files

- `src/components/ResizableWorkbenchPanel.jsx` (new): reusable expanded/collapsed panel, 42px rail, Lucide controls, pointer capture, active-drag document listeners, cleanup, and commit-only persistence callback.
- `src/App.css`: workbench panel, rail, divider, active-resize, and recovered-width (`min-width: 0`) styles.
- `src/lib/workbenchPanelState.test.js`: pointer-derived lower/upper clamp assertions.
- `docs/superpowers/plans/2026-07-12-resizable-workbench-panels.md`: Task 2 checkboxes completed.

## RED/GREEN Evidence

- RED exception: Task 1 already supplied `normalizeWorkbenchPanelState` with lower and upper clamping. Adding the mandated Task 2 boundary test therefore passed immediately rather than failing; no Task 1 code or tests were modified beyond the allowed assertion.
- GREEN: `node --test src/lib/workbenchPanelState.test.js` passed 9/9 tests.
- Production build: `npm run build` completed successfully with Vite 8.0.11.
- Scoped lint: `npx eslint src/components/ResizableWorkbenchPanel.jsx` passed.
- Whitespace: `git diff --check` passed before commit.

## Self-Review

- The handle calls `setPointerCapture`, installs `pointermove`, `pointerup`, and `pointercancel` listeners only during an active drag, and removes them along with the body class on pointer up, cancel, and unmount.
- Each pointer move normalizes the width through the Task 1 helper and invokes `onPanelChange`; `onPanelCommit` runs once after drag completion. Collapse/expand is also committed immediately.
- Callback refs keep an in-progress drag intact if parent callbacks change identity as panel state re-renders.
- The component and CSS stay isolated; no integration files were touched.

## Commit

- `fa6ac8bbfbc2ba152e9640c146231247cc7b57f1` - `feat: add resizable workbench panel primitive`

## Concerns

- Repository-wide `npm run lint` remains failing due to pre-existing errors in server, scratch, and unrelated UI files. The new component passes scoped lint.
- No browser integration was performed because Task 2 deliberately does not wire the primitive into `App.jsx` or `TrajectoryPage.jsx`; Task 3 owns that work.

---

## Task 2 Correction: Collapsed Rail And Drag Lifecycle Coverage

### Scope

- Preserved the user-owned uncommitted `harnesses/02-bash.json`; it was neither modified nor staged by this correction.
- Added the passed panel `icon` to the collapsed 42px rail while retaining the expand button's existing tooltip and accessible label.
- Extracted the active pointer-drag lifecycle into `src/lib/workbenchPanelDrag.js`, with injected event target and body class list so it remains DOM-agnostic and testable with Node's built-in test runner.

### RED/GREEN Evidence

- RED: `node --test src/lib/workbenchPanelDrag.test.js` failed with `ERR_MODULE_NOT_FOUND` for `src/lib/workbenchPanelDrag.js`, demonstrating that the focused lifecycle behavior had no implementation.
- GREEN: `node --test src/lib/workbenchPanelState.test.js src/lib/workbenchPanelDrag.test.js` passed 11/11 tests.
- Scoped lint: `npx eslint src/components/ResizableWorkbenchPanel.jsx src/lib/workbenchPanelDrag.js src/lib/workbenchPanelDrag.test.js` passed.
- Build: `npm run build` passed with Vite 8.0.11.
- Whitespace: `git diff --check` passed.

### Lifecycle Coverage

- Tests verify drag listener installation at start and removal after matching pointer up, pointer cancel, and explicit unmount-style cleanup.
- Tests verify pointer-id filtering, one `onChange` call per matching move, one commit after successful matching pointer up, no duplicate commit, and no commits for cancel or cleanup.
- Tests verify the `workbench-is-resizing` body class and pointer capture are cleared in all terminal paths.

### Behavioral Notes

- Document listeners are still installed only when a drag begins.
- Width updates still use `onPanelChange` during movement; persistence-facing `onPanelCommit` runs once only after a successful pointer-up completion.
- Pointer cancellation and unmount cleanup remove listeners, release capture, clear the resize class, and do not persist.
