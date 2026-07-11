# MCP Observability And Permission UX Design

> **Implementation status:** Complete on `codex/mcp-runtime-mounting`. Task 19, Runtime Resource Mount Registry, is next.

**Status:** Proposed for revised review

## Goal

Complete Task 18 by making MCP runtime state, connection failures, tool calls, and approvals observable and controllable without coupling AgentExecutor to MCP provider details or flooding the main trajectory with raw server output.

## Scope

- Add harness-scoped MCP approval policy inheritance.
- Route MCP approval decisions through the existing SecurityPlugin and permission modal.
- Add explicit MCP lifecycle states, bounded diagnostics, disconnect/reconnect controls, and bounded call records.
- Add provider-neutral credential sources and runtime authentication status.
- Surface relevant state in MCP Studio and existing Context Inspector / trajectory surfaces.
- Exclude OAuth, server installation, marketplace discovery, remote secret storage, and generic resource registry work.

## Approval Policy

Approval policy belongs to the harness MCP mount, because the same server may be safe in one harness and sensitive in another.

```json
{
  "enabled": true,
  "mountedServers": ["context7", "github"],
  "toolAllowlist": {
    "context7": ["resolve-library-id", "query-docs"],
    "github": ["search_issues", "create_issue"]
  },
  "approvalMode": "auto_readonly",
  "serverApprovalModes": {
    "github": "ask_all"
  },
  "toolApprovalModes": {
    "github": {
      "search_issues": "auto_all"
    }
  }
}
```

Supported explicit modes:

- `auto_readonly`: execute only MCP tools whose annotations include `readOnlyHint: true`.
- `ask_all`: request approval for every MCP tool call.
- `auto_all`: execute every MCP tool call without an MCP-specific approval prompt.

The effective mode resolves in this order:

```text
toolApprovalModes[serverId][toolName]
  > serverApprovalModes[serverId]
  > approvalMode
  > auto_readonly
```

When the effective mode is `auto_readonly`, a missing or false `readOnlyHint` requires approval. This is fail-closed for unknown MCP tools.

## Runtime Boundary

`McpManager` becomes the MCP runtime owner. It exposes a normalized status record per server:

```js
{
  serverId,
  status: 'starting' | 'connected' | 'error' | 'stopped',
  connectedAt: string | null,
  lastError: { code: string, message: string } | null,
  diagnostic: string,
  authentication: {
    status: 'anonymous' | 'configured' | 'verified' | 'invalid' | 'unknown',
    source: 'none' | 'literal' | 'environment' | 'headers' | 'bearer' | 'oauth'
  },
  tools: [],
  toolDefinitions: []
}
```

Lifecycle semantics are explicit:

- `starting`: Connect or Reconnect has been requested and transport setup is in progress.
- `connected`: initialize and tool discovery succeeded.
- `error`: the latest lifecycle or tool operation failed; the safe structured error remains visible.
- `stopped`: no active managed connection exists, either before first start, after Disconnect, or after a managed STDIO process exits cleanly.

The MCP Studio updates to `starting` immediately after a Connect or Reconnect click. It never waits for a request timeout before showing that work is in progress.

## Credential Sources And Authentication Status

Credential configuration remains provider-neutral. A credential value may be saved locally as a literal or resolved from a named process environment variable at runtime. A binding may target STDIO process environment, an arbitrary HTTP header, or the standard Authorization Bearer form.

```json
{
  "env": {
    "SERVICE_TOKEN": { "source": "environment", "name": "SERVICE_TOKEN" },
    "LOCAL_TOKEN": { "source": "literal", "value": "local-token" }
  },
  "headers": {
    "X-API-Key": { "source": "environment", "name": "REMOTE_API_KEY" },
    "Authorization": { "source": "bearer", "value": "local-token" }
  }
}
```

Task 17 string maps remain valid shorthand and are interpreted as literal values. The Studio can render and save either representation. Existing direct credentials remain unchanged. `Bearer` is only a shortcut for an Authorization header and does not identify a provider.

OAuth is represented as an unavailable runtime capability (`source: 'oauth'`, `status: 'unknown'`) until a future transport adapter implements discovery, browser authorization, token refresh, and secure token storage. Task 18 does not implement OAuth login UI.

Authentication status reflects runtime evidence, never guessed provider names:

- `anonymous`: no credential source is configured.
- `configured`: one or more credentials are configured but no authenticated operation has verified them.
- `verified`: a tool operation that reached the upstream service completed successfully after connection.
- `invalid`: an operation received a classified authentication failure, such as HTTP 401 or 403.
- `unknown`: the transport cannot determine authentication outcome, including OAuth not yet supported.

Initialize and tools/list success alone never changes status to `verified`, because those operations may not contact an authenticated upstream API.

The manager records a bounded in-memory call history per server:

```js
{
  id,
  serverId,
  toolName,
  startedAt,
  durationMs,
  status: 'success' | 'error',
  argumentKeys: [],
  outputPreview,
  error: ''
}
```

Only argument key names and a short output preview are recorded. Raw arguments, API keys, environment values, request headers, and full tool output are never written to the MCP runtime log. Records are bounded in memory and intentionally disappear after a server restart; persistent audit storage is out of scope.

STDIO stderr is captured as a bounded trailing diagnostic buffer. It is exposed only after a connection or call failure, and is redacted against configured `server.env` values before presentation.

The call-history API returns only compact summaries. A separate single-record endpoint resolves an individual bounded detail record on demand, so MCP Studio does not render every output preview during normal server-list loading.

Structured errors use one of these codes:

```text
spawn_failed | initialize_failed | timeout | process_exited |
transport_error | authentication_failed | tool_call_failed
```

## Execution Flow

```text
Model emits mcp__server__tool
  -> AgentExecutor provides the harness MCP mount snapshot
  -> SecurityPlugin asks McpPolicyResolver for effective policy
  -> allow automatically, or reuse the existing permission_request event
  -> ToolRegistry delegates to McpManager.callTool
  -> McpManager updates status and bounded call record
  -> Agent trajectory receives the normal tool result
```

`SecurityPlugin` remains the only permission gate. MCP does not add a second modal or a separate pending-request mechanism.

The normal agent security mode remains authoritative for global hard blocks. `auto_all` only bypasses MCP-specific approval, not permanent system blocks or any later global policy that applies to MCP tools.

## API

Task 18 adds focused MCP runtime routes:

- `GET /api/mcp/servers/:serverId/status`
- `POST /api/mcp/servers/:serverId/disconnect`
- `GET /api/mcp/servers/:serverId/calls?limit=20`
- `GET /api/mcp/servers/:serverId/calls/:callId`

Existing `connect` and `refresh-tools` routes return the expanded status shape. Existing server-list and harness-mount routes return the expanded mount policy unchanged for callers that do not use the new fields.

## UI

MCP Studio presents:

- lifecycle pill: Starting, Connected, Error, Stopped;
- last safe error / diagnostic when a server fails;
- Connect, Reconnect, and Disconnect controls;
- credential source and runtime authentication status, without displaying masked or raw values in status cards;
- harness default approval mode in the mount panel;
- optional server override in server detail;
- per-tool override control adjacent to the mounted-tool choice;
- recent calls table with time, tool, duration, result, and argument keys; an individual detail panel loads the bounded preview only when opened.

Controls use inheritance explicitly: an unset server/tool override is displayed as “Inherit harness policy.” The existing trajectory remains concise and shows only actual MCP tool calls/results. Context Inspector continues to show sent MCP schemas; it gains the active effective mount policy summary rather than runtime log payloads.

## Compatibility

- Existing mount files with only `approvalMode` load unchanged.
- Existing string-valued `env` and `headers` remain literal local values.
- Existing configured Echo and Context7 mounts inherit `auto_readonly`; both tools advertise `readOnlyHint: true`, so their behavior remains auto-approved.
- New override maps are normalized for safe server and tool IDs. Empty override entries are dropped.
- Existing `ask_all` and `auto_all` mount behavior becomes active for the first time; this is intentional completion of the existing persisted setting.

## Testing

- Mount normalization and policy resolution test all inheritance levels and unknown-tool fail-closed behavior.
- SecurityPlugin tests verify an MCP write-like tool creates the existing permission request, while an annotated read-only tool is auto-executed.
- McpManager tests verify status transitions, bounded diagnostics, bounded logs, lazy single-record lookup, successful calls, and failed calls.
- Credential tests cover literal and environment sources, anonymous/configured/verified/invalid transitions, and classified HTTP authentication failures.
- Route tests cover status, disconnect, and call history.
- UI pure helpers test policy labels and compact call-record presentation.
- Existing Echo and Context7 MCP integration tests remain green.

## Acceptance Criteria

1. A user can set default, server-level, and tool-level MCP approval policies for one harness.
2. A non-read-only MCP tool requires the existing approval dialog by default.
3. Read-only Context7 and Echo tools remain automatic under the default policy.
4. Connection and call failures show a safe, bounded diagnostic in MCP Studio.
5. MCP Studio immediately displays `starting` after Connect or Reconnect.
6. Users can see anonymous/configured/verified/invalid authentication state without exposing raw credentials in status UI.
7. Users can disconnect and reconnect a managed STDIO server.
8. Users can inspect recent MCP calls without exposing raw credentials or flooding the trajectory.
9. AgentExecutor remains provider-neutral and does not branch on MCP server identity.
