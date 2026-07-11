# MCP Observability And Permission UX Implementation Plan

> **Status:** Complete. Task 19, Runtime Resource Mount Registry, is the next planned phase.

**Goal:** Make MCP lifecycle, authentication evidence, tool-call records, and harness-scoped approvals observable and controllable while preserving MCP as an independent runtime layer.

**Architecture:** MCP configuration supports literal and environment-reference values without provider-specific branches. `McpManager` owns state, diagnostics, and bounded logs; `McpPolicyResolver` resolves harness/server/tool policy; `SecurityPlugin` remains the only approval gate. AgentExecutor receives only a mount-policy snapshot and dynamic tool definitions.

**Tech Stack:** Node.js ESM, Express, React, Lucide icons, node:test, existing SSE permission flow.

## Global Constraints

- Do not branch on MCP server ID, provider, or API-key name.
- Existing string-valued `env` and `headers` remain valid literal local values.
- Do not expose raw credentials, header values, or full tool arguments in runtime status or call logs.
- Existing `approvalMode` mount files and Context7 / Echo behavior remain compatible.
- Direct credentials remain local under Git-ignored `.mcp/servers.json`.

---

### Task 1: Generic Credential Values And Authentication Presentation

**Files:**
- Modify: `server/mcp/mcpConfigStore.js`
- Modify: `server/mcp/mcpClient.js`
- Modify: `src/lib/mcpConfigPresentation.js`
- Modify: `server/mcp/mcpConfigStore.test.js`
- Modify: `server/mcp/mcpClient.test.js`
- Modify: `src/lib/mcpConfigPresentation.test.js`

**Interfaces:**
- Produces: `normalizeMcpValue(value): string | { source, value?|name? }`
- Produces: `resolveMcpValue(value, processEnv): { value: string, source: 'literal'|'environment'|'bearer'|'oauth', configured: boolean } | null`
- Produces: editor rows `{ key, value, source }` for literal and environment-reference entries.

- [x] **Step 1: Write failing credential compatibility tests.**

```js
assert.deepEqual(resolveMcpValue({ source: 'environment', name: 'TOKEN' }, { TOKEN: 'secret' }), {
  value: 'secret', source: 'environment', configured: true,
});
assert.equal(resolveMcpValue({ source: 'environment', name: 'MISSING' }, {}), null);
assert.equal(resolveMcpValue('legacy-literal', {})?.value, 'legacy-literal');
```

- [x] **Step 2: Run focused tests and verify they fail because object values are coerced to strings.**

Run: `node --test server/mcp/mcpConfigStore.test.js server/mcp/mcpClient.test.js src/lib/mcpConfigPresentation.test.js`

- [x] **Step 3: Implement normalization and resolution.**

Preserve legacy strings, validate only `literal`, `environment`, `bearer`, and `oauth` object sources, and omit an unresolved environment binding from a spawned STDIO environment or HTTP header. Bearer resolves to `Bearer <token>` only when it is bound to a header.

- [x] **Step 4: Extend the Studio key-value row model with a source selector.**

Direct value remains the default. Environment reference stores the variable name, not its resolved value. OAuth remains a disabled future source with explanatory copy.

- [x] **Step 5: Run focused tests and commit.**

Run: `node --test server/mcp/mcpConfigStore.test.js server/mcp/mcpClient.test.js src/lib/mcpConfigPresentation.test.js && npm run build`

Commit: `feat: add generic mcp credential sources`

### Task 2: MCP Lifecycle, Diagnostics, And Bounded Call Records

**Files:**
- Modify: `server/mcp/mcpClient.js`
- Modify: `server/mcp/mcpManager.js`
- Create: `server/mcp/mcpRuntimeLog.js`
- Create: `server/mcp/mcpRuntimeLog.test.js`
- Modify: `server/mcp/mcpClient.test.js`
- Modify: `server/mcp/mcpManager.test.js`

**Interfaces:**
- Produces: status values `starting | connected | error | stopped`.
- Produces: structured error `{ code, message }` and bounded redacted diagnostic text.
- Produces: `listCallSummaries(serverId, { limit })` and `getCallDetail(serverId, callId)`.
- Produces: `disconnectServer(serverId)`.

- [x] **Step 1: Write failing lifecycle and log tests.**

```js
assert.equal((await manager.getServerStatus('echo')).status, 'stopped');
await assert.rejects(() => manager.connectServer('missing'), /Unknown MCP server/);
assert.equal((await manager.getServerStatus('missing')).status, 'error');
assert.equal((await manager.listCallSummaries('echo')).length, 1);
assert.deepEqual((await manager.getCallDetail('echo', callId)).argumentKeys, ['text']);
```

- [x] **Step 2: Run tests and verify they fail because manager only reports connected/disconnected and has no log store.**

Run: `node --test server/mcp/mcpManager.test.js server/mcp/mcpClient.test.js`

- [x] **Step 3: Implement `mcpRuntimeLog.js`.**

Keep at most 50 summaries per server and at most 2,000 characters per output preview. Store only argument key names. Detail lookup returns one bounded record or `null`.

- [x] **Step 4: Add client diagnostic capture and error classification.**

Capture trailing STDIO stderr, redact configured literal environment values, and classify `spawn_failed`, `initialize_failed`, `timeout`, `process_exited`, `transport_error`, `authentication_failed`, and `tool_call_failed`.

- [x] **Step 5: Make McpManager own transitions and authentication evidence.**

Set `starting` before connect, `connected` only after tool discovery, `error` on failures, and `stopped` after disconnect or managed exit. Mark auth `verified` only after a successful tool call, and `invalid` after classified HTTP 401/403.

- [x] **Step 6: Run focused tests and commit.**

Run: `node --test server/mcp/mcpClient.test.js server/mcp/mcpManager.test.js server/mcp/mcpRuntimeLog.test.js`

Commit: `feat: add mcp runtime lifecycle and logs`

### Task 3: Harness MCP Policy And Existing Permission Gate Integration

**Files:**
- Modify: `server/mcp/mcpMountStore.js`
- Create: `server/mcp/mcpPolicy.js`
- Create: `server/mcp/mcpPolicy.test.js`
- Modify: `server/agent/AgentExecutor.js`
- Modify: `server/routes/agentRunRoutes.js`
- Modify: `server/routes/harnessRoutes.js`
- Modify: `server/agent/plugins/SecurityPlugin.js`
- Modify: `server/mcp/mcpMountStore.test.js`
- Modify: `server/agent/plugins/SecurityPlugin.test.js`

**Interfaces:**
- Produces: `resolveMcpApprovalPolicy({ mount, toolDefinition }): { mode, source, requiresApproval }`.
- Consumes: `serverApprovalModes` and `toolApprovalModes` from the mount snapshot.
- Produces: `mcpMount` on AgentExecutor for the current run.

- [x] **Step 1: Write failing policy inheritance tests.**

```js
assert.deepEqual(resolveMcpApprovalPolicy({ mount, toolDefinition: readOnlyTool }), {
  mode: 'auto_readonly', source: 'harness', requiresApproval: false,
});
assert.equal(resolveMcpApprovalPolicy({ mount, toolDefinition: writeTool }).requiresApproval, true);
assert.equal(resolveMcpApprovalPolicy({ mount: toolOverrideMount, toolDefinition: writeTool }).source, 'tool');
```

- [x] **Step 2: Run tests and verify they fail because override maps are absent.**

Run: `node --test server/mcp/mcpMountStore.test.js server/mcp/mcpPolicy.test.js`

- [x] **Step 3: Normalize mount override maps and implement resolver.**

Only valid modes remain. Normalize server IDs and drop empty tool overrides. Missing `readOnlyHint` is treated as non-read-only.

- [x] **Step 4: Pass the exact mount snapshot into real and dry-run AgentExecutor construction.**

`AgentExecutor` stores `this.mcpMount`; no provider identity is added to AgentExecutor logic.

- [x] **Step 5: Add the MCP branch to SecurityPlugin before generic suspicious-rule evaluation.**

For names parsed by `parseMcpToolName`, locate the dynamic tool definition from `executor.tools`, resolve policy, and create the existing `permission_request` when required. `auto_all` and annotated read-only defaults continue directly to ToolRegistry.

- [x] **Step 6: Run focused tests and commit.**

Run: `node --test server/mcp/mcpMountStore.test.js server/mcp/mcpPolicy.test.js server/agent/plugins/SecurityPlugin.test.js server/routes/agentRunRoutes.test.js`

Commit: `feat: enforce harness mcp approval policies`

### Task 4: MCP Runtime APIs And Studio Observability

**Files:**
- Modify: `server/routes/mcpRoutes.js`
- Modify: `server/routes/mcpRoutes.test.js`
- Modify: `src/lib/mcpServers.js`
- Modify: `src/pages/McpPage.jsx`
- Modify: `src/index.css`
- Create: `src/lib/mcpRuntimePresentation.js`
- Create: `src/lib/mcpRuntimePresentation.test.js`
- Modify: `src/lib/contextInspectorModel.js`
- Modify: `src/lib/contextInspectorModel.test.js`

**Interfaces:**
- Produces: status, disconnect, call-summary, and call-detail API helpers.
- Produces: `formatMcpStatus`, `formatMcpAuthStatus`, and `formatMcpCallSummary`.
- Produces: Context Inspector policy summary without logs or credential values.

- [x] **Step 1: Write failing route and presentation tests.**

```js
assert.equal((await dispatchJson(app, 'GET', '/api/mcp/servers/echo/status')).body.status, 'stopped');
assert.equal((await dispatchJson(app, 'POST', '/api/mcp/servers/echo/disconnect')).body.status, 'stopped');
assert.equal(formatMcpAuthStatus({ status: 'verified' }).label, 'Verified');
```

- [x] **Step 2: Run tests and verify they fail because routes and presentation helpers are absent.**

Run: `node --test server/routes/mcpRoutes.test.js src/lib/mcpRuntimePresentation.test.js src/lib/contextInspectorModel.test.js`

- [x] **Step 3: Implement the four focused runtime endpoints and client helpers.**

Do not include runtime log details in `/api/mcp/servers`; fetch summaries only when the selected server is visible and a detail only when the user expands a record.

- [x] **Step 4: Update MCP Studio.**

Show starting state immediately, status/diagnostic/auth facts, Connect/Reconnect/Disconnect controls, default/server/tool policy selectors, and lazy recent-call detail panel. Do not render raw credentials, raw arguments, or full outputs in status cards.

- [x] **Step 5: Add Context Inspector policy summary.**

Show active mounted server policy sources and effective defaults, not MCP runtime call records.

- [x] **Step 6: Build, visually inspect MCP Studio, and commit.**

Run: `node --test server/routes/mcpRoutes.test.js src/lib/mcpRuntimePresentation.test.js src/lib/contextInspectorModel.test.js && npm run build`

Commit: `feat: add mcp runtime observability controls`

### Task 5: Documentation, Full Verification, And Task 18 Status

**Files:**
- Modify: `docs/mcp-setup.md`
- Modify: `docs/mcp-setup.zh-CN.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/DEVELOPMENT_SPEC.md`
- Modify: `docs/DEVELOPMENT_SPEC.en.md`
- Modify: `docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md`
- Modify: `docs/superpowers/specs/2026-07-11-mcp-observability-permission-design.md`

- [x] **Step 1: Document lifecycle, credential sources, authentication evidence, policy inheritance, and privacy limits for call logs.**

- [x] **Step 2: Mark Task 18 complete and set Task 19 Runtime Resource Mount Registry as the next planned phase.**

- [x] **Step 3: Run full verification and commit.**

Run: `npm test && npm run build && git diff --check`

Commit: `docs: close mcp task 18`
