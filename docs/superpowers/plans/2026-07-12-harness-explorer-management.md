# Harness Explorer Management UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished Harness Explorer with focused create, metadata edit, duplicate, and delete workflows.

**Architecture:** Backend routes expose narrow metadata and duplicate operations while preserving immutable IDs and physical filenames. Frontend management state is modeled with pure helpers, rendered by an extracted `HarnessExplorer` component, and connected to API/routing by `App.jsx`.

**Tech Stack:** Node.js ESM, Express, React, Lucide icons, CSS, `node:test`, Vite.

## Global Constraints

- Explorer edits only display name and description.
- Existing Harness IDs and physical filenames remain immutable.
- Duplicate copies Harness configuration but not runtime data.
- Explorer stays a desktop sidebar and does not add mobile behavior.
- Mutation errors remain visible in the active dialog.
- Create, Edit, and Duplicate share one dialog component.

---

### Task 1: Harness Metadata And Configurable Duplicate APIs

**Files:**
- Modify: `server/harnessIdentity.js`
- Modify: `server/harnessIdentity.test.js`
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/routes/harnessRoutes.test.js`
- Modify: `server/app/createServerApp.test.js`

**Interfaces:**
- Produces: `createCopiedHarnessDraft({ source, existingHarnesses, name?, description? })`
- Produces: `PATCH /api/harnesses/:id/metadata`

- [ ] Write failing tests proving custom duplicate names generate unique IDs and metadata updates preserve model/tools/features.
- [ ] Run `node --test server/harnessIdentity.test.js server/routes/harnessRoutes.test.js` and verify expected failures.
- [ ] Extend duplicate identity generation and add the narrow metadata route.
- [ ] Add the new route to the server endpoint contract snapshot.
- [ ] Run focused tests and commit as `feat: add harness metadata management api`.

### Task 2: Explorer State And Presentation Model

**Files:**
- Create: `src/lib/harnessExplorerState.js`
- Create: `src/lib/harnessExplorerState.test.js`

**Interfaces:**
- Produces: `createHarnessExplorerState()`
- Produces: `openHarnessDialog(state, mode, harness?)`
- Produces: `closeHarnessDialog(state)`
- Produces: `openHarnessDelete(state, harness)`
- Produces: `getHarnessCountLabel(count)`

- [ ] Write failing tests for Create/Edit/Duplicate/Delete drafts, generated ID preview, and count labels.
- [ ] Run `node --test src/lib/harnessExplorerState.test.js` and verify module-not-found.
- [ ] Implement minimal pure state and presentation helpers.
- [ ] Run tests and commit as `feat: add harness explorer state model`.

### Task 3: Extract And Build Harness Explorer UI

**Files:**
- Create: `src/components/HarnessExplorer.jsx`
- Modify: `src/App.jsx`
- Modify: `src/App.css`

**Interfaces:**
- Consumes: Harness list, active ID, busy state, error state, and mutation callbacks.
- Produces: one Explorer with row overflow menu, shared edit dialog, and delete confirmation.

- [ ] Extract the existing list into `HarnessExplorer` with Lucide refresh, plus, ellipsis, edit, copy, and trash icons.
- [ ] Add the three-mode form dialog and delete confirmation using state helpers from Task 2.
- [ ] Replace native `confirm()` and `alert()` mutation paths with callback results and inline errors.
- [ ] Replace the User Guide footer with Harness count/local workspace status.
- [ ] Run `npm run build` and commit as `feat: redesign harness explorer management`.

### Task 4: App Integration, Verification, And Documentation

**Files:**
- Modify: `src/App.jsx`
- Modify: `docs/superpowers/specs/2026-07-12-harness-explorer-management-design.md`
- Modify: `docs/superpowers/plans/2026-07-12-harness-explorer-management.md`

**Interfaces:**
- App callbacks return `{ ok, error?, harness? }` so Explorer can preserve failed drafts.

- [ ] Ensure create selects the new Harness, edit refreshes active Harness metadata, duplicate selects the copy, and delete selects the next post-delete Harness.
- [ ] Run `node --test server/harnessIdentity.test.js server/routes/harnessRoutes.test.js src/lib/harnessExplorerState.test.js`.
- [ ] Run `npm test`, `npm run build`, and `git diff --check`.
- [ ] Manually verify long-name truncation, menu actions, all dialogs, and active deletion.
- [ ] Mark the spec/plan implemented and commit as `docs: close harness explorer management ux`.
