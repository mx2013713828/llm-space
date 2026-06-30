# Security Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the experimental platform's security and runtime foundations before starting teams-v2.

**Architecture:** Add small reusable boundary helpers instead of scattering guards across tools and routes. Server tools enforce their own path policy even when plugin-level security is bypassed. Frontend API calls go through a single client helper so deployment configuration and tests stop depending on hard-coded localhost URLs.

**Tech Stack:** Node.js ESM, Express 5, React 19, Vite, `node:test`.

## Global Constraints

- Keep this branch focused on hardening, not teams-v2 feature work.
- Prefer direct, testable helpers over broad rewrites of `server.js` or `useAgentLoop.js`.
- Use TDD for behavior changes.
- Commit each task separately.
- Preserve local experimental workflow; do not add heavyweight authentication in this phase.

---

## File Structure

- Create `server/tools/pathPolicy.js`
  - Resolves workspace-relative paths.
  - Rejects path traversal outside `process.cwd()`.
  - Rejects sensitive files such as `.env`, `.env.*`, and common key material.
- Modify `server/tools/read_file.js`
  - Use `resolveToolPathForRead`.
- Modify `server/tools/write_file.js`
  - Use `resolveToolPathForWrite`.
- Modify `server/tools/toolValidation.test.js`
  - Cover missing/invalid args, traversal denial, sensitive read denial, and ordinary workspace read/write.
- Modify `server.js`
  - Reject duplicate harness ids during create/copy.
  - Disable legacy `/api/chat` endpoint with `410 Gone`.
- Create or modify server route tests if route extraction is introduced.
- Create `src/lib/apiClient.js`
  - Centralize `API_BASE` and URL construction.
- Modify frontend API callers gradually:
  - `src/App.jsx`
  - `src/pages/PromptLabPage.jsx`
  - `src/pages/TrajectoryPage.jsx`
  - `src/hooks/useAgentLoop.js`
  - `src/hooks/useModels.js`
  - `src/components/ContextInspector.jsx`
  - `src/lib/cronJobs.js`
  - `src/lib/sessionApi.js`
  - `src/lib/childTraceReference.js`
- Create `src/components/AppErrorBoundary.jsx`
  - Catch render-time crashes and show a minimal recoverable fallback.
- Modify `package.json`
  - Add `test` script.

---

### Task 1: Tool Path Policy

**Files:**
- Create: `server/tools/pathPolicy.js`
- Modify: `server/tools/read_file.js`
- Modify: `server/tools/write_file.js`
- Modify: `server/tools/toolValidation.test.js`

**Interfaces:**
- Produces: `resolveToolPathForRead(filePath, options?)`
- Produces: `resolveToolPathForWrite(filePath, options?)`
- Consumes: `process.cwd()` as the default workspace root.

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```js
assert.match(await readFile.execute({ path: '../outside.txt' }), /Access denied/i);
assert.match(await readFile.execute({ path: '.env' }), /Access denied/i);
assert.match(await writeFile.execute({ path: '../outside.txt', content: 'x' }), /Access denied/i);
assert.match(await writeFile.execute({ path: '.agent-scratch/test.txt', content: 'x' }), /Successfully wrote/);
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test server/tools/toolValidation.test.js
```

Expected: traversal and sensitive-file tests fail because the tools currently call `path.resolve` directly.

- [ ] **Step 3: Implement path policy**

Implement a helper that:

- resolves the requested path against `rootDir`
- rejects paths not equal to `rootDir` or inside `rootDir`
- rejects basename `.env`, names starting `.env.`, and extensions `.pem`, `.key`, `.p12`, `.pfx`
- returns `{ ok: true, path: resolvedPath }` or throws a readable error

- [ ] **Step 4: Verify green**

Run:

```bash
node --test server/tools/toolValidation.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tools/pathPolicy.js server/tools/read_file.js server/tools/write_file.js server/tools/toolValidation.test.js
git commit -m "fix: guard tool filesystem access"
```

---

### Task 2: Harness Identity and Legacy Chat Endpoint

**Files:**
- Modify: `server.js`
- Create if useful: `server/harnessRoutes.test.js`

**Interfaces:**
- Produces: duplicate-id rejection during harness create/copy.
- Produces: `/api/chat` returns `410 Gone`.

- [ ] **Step 1: Write failing tests**

Cover pure helper behavior if extracted, or route behavior if server route extraction is introduced:

```js
assert.equal(ensureUniqueHarnessId([{ id: 'demo' }], 'demo').ok, false);
```

For `/api/chat`, assert the handler returns HTTP 410 and does not call the model provider.

- [ ] **Step 2: Verify red**

Run the focused server tests.

- [ ] **Step 3: Implement minimal backend cleanup**

- Add a helper that scans existing harness JSON files for duplicate ids.
- Reject create/copy when the generated id already exists.
- Replace legacy `/api/chat` implementation with a `410 Gone` response and a short deprecation message.

- [ ] **Step 4: Verify green**

Run focused tests.

- [ ] **Step 5: Commit**

```bash
git add server.js server/harnessRoutes.test.js
git commit -m "fix: harden harness identity boundaries"
```

---

### Task 3: Frontend API Boundary and Crash Recovery

**Files:**
- Create: `src/lib/apiClient.js`
- Modify: listed frontend API callers
- Create: `src/components/AppErrorBoundary.jsx`
- Modify: `src/App.jsx`
- Modify: `package.json`

**Interfaces:**
- Produces: `apiUrl(path)` and `apiFetch(path, options?)`.
- Produces: app-level error boundary fallback.
- Produces: `npm test` script.

- [ ] **Step 1: Write failing tests**

Add `src/lib/apiClient.test.js`:

```js
assert.equal(apiUrl('/api/health'), 'http://localhost:3001/api/health');
assert.equal(apiUrl('api/health'), 'http://localhost:3001/api/health');
```

Add a lightweight ErrorBoundary test if practical.

- [ ] **Step 2: Verify red**

Run:

```bash
node --test src/lib/apiClient.test.js
```

Expected: FAIL because `apiClient.js` does not exist.

- [ ] **Step 3: Implement client helper and migrate callers**

- Use `import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'`.
- Replace hard-coded fetch URLs with `apiFetch` or `apiUrl`.
- Add `npm test` as `node --test $(rg --files -g '*test.js' | sort)`.
- Wrap the application tree with `AppErrorBoundary`.

- [ ] **Step 4: Verify green**

Run:

```bash
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json src
git commit -m "refactor: centralize frontend api boundary"
```

---

### Task 4: Full Verification and Status Update

**Files:**
- Modify: `docs/superpowers/plans/2026-06-30-security-runtime-hardening.md`
- Modify if needed: `docs/memory/status.md`

- [ ] **Step 1: Run source scans**

```bash
rg "http://localhost:3001" src
rg "path.resolve\\(process.cwd\\(\\), filePath\\)" server/tools
```

Expected:

- no direct frontend localhost API calls outside tests or `apiClient`
- no direct tool path resolution bypassing `pathPolicy`

- [ ] **Step 2: Run full verification**

```bash
npm test
npm run build
```

Expected: PASS.

- [ ] **Step 3: Update plan checkboxes and status**

Record completed commits and verification results.

- [ ] **Step 4: Commit docs**

```bash
git add docs/superpowers/plans/2026-06-30-security-runtime-hardening.md docs/memory/status.md
git commit -m "docs: mark security hardening progress"
```

## Self-Review

- Spec coverage: Covers the immediate hardening issues accepted from review: tool path safety, harness id collision, stale `/api/chat`, frontend API hardcode, Error Boundary, and test script.
- Placeholder scan: No placeholder steps remain.
- Type consistency: Helper names are defined before use.
