# MCP Observability And Permission UX Design

**Status:** Proposed for review

## Goal

Complete Task 18 by making MCP runtime state, connection failures, tool calls, and approvals observable and controllable without coupling AgentExecutor to MCP provider details or flooding the main trajectory with raw server output.

## Scope

- Add harness-scoped MCP approval policy inheritance.
- Route MCP approval decisions through the existing SecurityPlugin and permission modal.
- Add explicit MCP lifecycle states, bounded diagnostics, disconnect/reconnect controls, and bounded call records.
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
  status: 'disconnected' | 'connecting' | 'connected' | 'error',
  connectedAt: string | null,
  lastError: string,
  diagnostic: string,
  tools: [],
  toolDefinitions: []
}
```

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

Existing `connect` and `refresh-tools` routes return the expanded status shape. Existing server-list and harness-mount routes return the expanded mount policy unchanged for callers that do not use the new fields.

## UI

MCP Studio presents:

- lifecycle pill: Disconnected, Connecting, Connected, Error;
- last safe error / diagnostic when a server fails;
- Connect, Reconnect, and Disconnect controls;
- harness default approval mode in the mount panel;
- optional server override in server detail;
- per-tool override control adjacent to the mounted-tool choice;
- recent calls table with time, tool, duration, result, argument keys, and expandable bounded preview.

Controls use inheritance explicitly: an unset server/tool override is displayed as “Inherit harness policy.” The existing trajectory remains concise and shows only actual MCP tool calls/results. Context Inspector continues to show sent MCP schemas; it gains the active effective mount policy summary rather than runtime log payloads.

## Compatibility

- Existing mount files with only `approvalMode` load unchanged.
- Existing configured Echo and Context7 mounts inherit `auto_readonly`; both tools advertise `readOnlyHint: true`, so their behavior remains auto-approved.
- New override maps are normalized for safe server and tool IDs. Empty override entries are dropped.
- Existing `ask_all` and `auto_all` mount behavior becomes active for the first time; this is intentional completion of the existing persisted setting.

## Testing

- Mount normalization and policy resolution test all inheritance levels and unknown-tool fail-closed behavior.
- SecurityPlugin tests verify an MCP write-like tool creates the existing permission request, while an annotated read-only tool is auto-executed.
- McpManager tests verify status transitions, bounded diagnostics, bounded logs, successful calls, and failed calls.
- Route tests cover status, disconnect, and call history.
- UI pure helpers test policy labels and compact call-record presentation.
- Existing Echo and Context7 MCP integration tests remain green.

## Acceptance Criteria

1. A user can set default, server-level, and tool-level MCP approval policies for one harness.
2. A non-read-only MCP tool requires the existing approval dialog by default.
3. Read-only Context7 and Echo tools remain automatic under the default policy.
4. Connection and call failures show a safe, bounded diagnostic in MCP Studio.
5. Users can disconnect and reconnect a managed STDIO server.
6. Users can inspect recent MCP calls without exposing raw credentials or flooding the trajectory.
7. AgentExecutor remains provider-neutral and does not branch on MCP server identity.
