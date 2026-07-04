# AGENTS.md Guidance File Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store editable base agent instructions in `guidance/<harnessId>/AGENTS.md` instead of harness JSON.

**Architecture:** Add a small server-side guidance module, hydrate harness responses from that module, and redirect harness save requests so `systemPrompt` writes to `AGENTS.md`. Frontend copy changes make the editor visible as AGENTS.md while preserving the existing API field for compatibility.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing React components, filesystem-backed harness configuration.

## Global Constraints

- First stage mounts exactly one file: `guidance/<harnessId>/AGENTS.md`.
- `harnesses/*.json.systemPrompt` is legacy fallback only.
- Do not commit unrelated dirty harness or docs files.
- Use tests before production code changes.

---

### Task 1: Guidance File Store

**Files:**
- Create: `server/agent/guidance/agentGuidance.js`
- Create: `server/agent/guidance/agentGuidance.test.js`

**Interfaces:**
- Produces: `loadAgentGuidance({ harnessId, fallbackContent, guidanceRoot, fsImpl })`
- Produces: `saveAgentGuidance({ harnessId, content, guidanceRoot, fsImpl })`
- Produces: `stripLegacySystemPrompt(harness)`

- [ ] Test path safety, fallback initialization, and save behavior.
- [ ] Implement the guidance store.
- [ ] Run `node --test server/agent/guidance/agentGuidance.test.js`.
- [ ] Commit with `feat: add agent guidance file store`.

### Task 2: Harness Route Integration

**Files:**
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/routes/harnessRoutes.test.js`
- Modify: `server/app/createServerApp.test.js` only if route list changes.

**Interfaces:**
- Consumes: guidance store functions from Task 1.
- Produces: hydrated harness JSON with `systemPrompt` from `AGENTS.md` and `guidance.file`.

- [ ] Test GET initializes guidance from legacy JSON.
- [ ] Test POST writes prompt to AGENTS.md and removes `systemPrompt` from saved JSON.
- [ ] Implement route integration.
- [ ] Run `node --test server/routes/harnessRoutes.test.js`.
- [ ] Commit with `feat: persist harness guidance to AGENTS md`.

### Task 3: Frontend Labels

**Files:**
- Modify: `src/pages/PromptLabPage.jsx`
- Modify: `src/components/ConfigPanel.jsx`
- Modify: `src/pages/TrajectoryPage.jsx` if needed for path display.

**Interfaces:**
- Consumes: `harness.guidance.file`.
- Keeps using `systemPrompt` for API compatibility.

- [ ] Update editor labels from Base System Prompt to AGENTS.md / Agent Guidance.
- [ ] Display `guidance/<harnessId>/AGENTS.md` when available.
- [ ] Run `npm run build`.
- [ ] Commit with `ui: rename base prompt editor to AGENTS md`.

### Task 4: Full Verification

**Files:**
- No production files unless verification exposes a bug.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Check `git status --short` and ensure unrelated files are not staged.
