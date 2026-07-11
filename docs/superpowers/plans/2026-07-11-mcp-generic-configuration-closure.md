# MCP Generic Configuration Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Task 17 with vendor-neutral local MCP configuration for arbitrary STDIO environment variables and Streamable HTTP headers, while preserving legacy bearer-env configurations.

**Architecture:** `.mcp/servers.json` remains the local, Git-ignored project store. `env` is passed to STDIO child processes and overrides inherited process values; `headers` is sent to Streamable HTTP servers. The old `auth.bearer.env` field is read-compatible: only the server being edited is migrated on save, while unrelated legacy server entries remain byte-semantically intact.

**Tech Stack:** Node.js ESM, Express, React, node:test, existing MCP runtime.

## Global Constraints

- Do not branch on MCP server ID, provider, or API key name.
- Direct credentials may be stored locally in `.mcp/servers.json`.
- Do not modify existing `.mcp/servers.json` during migration.
- Keep legacy `{ auth: { type: 'bearer', env: 'NAME' } }` runtime-compatible until an edit/save.
- Keep Echo and Context7 credential-free STDIO configs functional through inherited environment variables.

---

### Task 1: Normalize Generic MCP Credentials And Request Headers

**Files:**
- Modify: `server/mcp/mcpConfigStore.js`
- Modify: `server/mcp/mcpClient.js`
- Modify: `server/mcp/mcpConfigStore.test.js`
- Create: `server/mcp/mcpClient.test.js`

**Interfaces:**
- Produces: `normalizeMcpStringMap(value): Record<string, string>` for persisted `env` and `headers`.
- Produces: `buildMcpHttpHeaders(server, processEnv): Record<string, string>` for protocol defaults, generic headers, and legacy compatibility.

- [ ] **Step 1: Write failing config normalization tests**

```js
test('persists generic STDIO environment variables and HTTP headers without auth metadata', async () => {
  const saved = await upsertMcpServer({
    rootDir,
    server: {
      id: 'generic', transport: 'streamable_http', url: 'https://example.test/mcp',
      headers: { 'X-API-Key': 'local-key' }, env: { SERVICE_TOKEN: 'token' },
    },
  });
  assert.deepEqual(saved.headers, { 'X-API-Key': 'local-key' });
  assert.deepEqual(saved.env, { SERVICE_TOKEN: 'token' });
  assert.equal(Object.hasOwn(saved, 'auth'), false);
});
```

- [ ] **Step 2: Run the config test and verify it fails because `auth` is still persisted.**

Run: `node --test server/mcp/mcpConfigStore.test.js`

- [ ] **Step 3: Normalize only non-empty string map entries and make legacy-auth migration explicit per saved server.**

```js
export function normalizeMcpStringMap(value = {}) {
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [String(key).trim(), String(entry).trim()])
    .filter(([key, entry]) => key && entry));
}
```

`listMcpServers()` preserves legacy `auth` for runtime use. `upsertMcpServer()` strips it only from the server supplied by the editor; `saveMcpServers()` preserves it for unrelated entries.

- [ ] **Step 4: Write failing HTTP header precedence and legacy bearer compatibility tests.**

```js
assert.equal(headers['X-API-Key'], 'local-key');
assert.equal(headers.Authorization, 'Bearer shell-token');
assert.equal(explicit.Authorization, 'Custom explicit value');
```

- [ ] **Step 5: Implement generic header assembly.**

`server.headers` wins case-insensitively over defaults and legacy Authorization. Legacy bearer auth adds Authorization only when no explicit Authorization header exists.

- [ ] **Step 6: Run focused tests and commit.**

Run: `node --test server/mcp/mcpConfigStore.test.js server/mcp/mcpClient.test.js server/mcp/mcpManager.test.js`

Commit: `feat: generalize mcp credentials and headers`

### Task 2: Expose Generic Environment And Header Editors In MCP Studio

**Files:**
- Modify: `src/pages/McpPage.jsx`
- Modify: `src/index.css`
- Create: `src/lib/mcpConfigPresentation.js`
- Create: `src/lib/mcpConfigPresentation.test.js`

**Interfaces:**
- Produces: `mapToEditorRows(map)` and `editorRowsToMap(rows)` for plain key-value configuration maps.
- Consumes: generic `server.env` and `server.headers` fields.

- [ ] **Step 1: Write failing map-editor conversion tests.**

```js
assert.deepEqual(editorRowsToMap([
  { key: 'X-API-Key', value: 'key' },
  { key: '', value: 'ignored' },
]), { 'X-API-Key': 'key' });
```

- [ ] **Step 2: Run the test and verify it fails because the helper is absent.**

Run: `node --test src/lib/mcpConfigPresentation.test.js`

- [ ] **Step 3: Implement the pure map editor helpers.**

- [ ] **Step 4: Replace the HTTP Auth selector with an HTTP Headers key-value editor. Add an Environment key-value editor to STDIO.**

The forms bind direct values into `env` or `headers`; no vendor names, bearer fields, or special authentication controls remain. The editor notes local-only Git-ignored storage and STDIO override precedence.

- [ ] **Step 5: Build and commit.**

Run: `node --test src/lib/mcpConfigPresentation.test.js && npm run build`

Commit: `feat: expose generic mcp credential editors`

### Task 3: Close Task 17 Documentation And Verify Existing Configs

**Files:**
- Modify: `docs/mcp-setup.md`
- Modify: `docs/mcp-setup.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-07-10-mcp-runtime-mounting.md`
- Modify: `docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md`

**Interfaces:**
- Produces: current setup documentation for direct credentials, inherited environment, and generic headers.
- Produces: roadmap status marking Task 17 complete and Task 18 as next.

- [ ] **Step 1: Update setup documentation.**

Document that direct values save locally in `.mcp/servers.json`, STDIO `env` overrides inherited shell variables, HTTP headers are arbitrary, and Context7 is configured by an ordinary `CONTEXT7_API_KEY` environment entry.

- [ ] **Step 2: Mark the Task 17 plan and consolidated roadmap complete.**

- [ ] **Step 3: Verify existing local config non-destructively.**

Run a read-only script that lists server IDs, transports, and map key names only. Confirm Echo and Context7 configurations still load and connect.

- [ ] **Step 4: Run full verification and commit.**

Run: `npm test && npm run build && git diff --check`

Commit: `docs: close mcp task 17`
