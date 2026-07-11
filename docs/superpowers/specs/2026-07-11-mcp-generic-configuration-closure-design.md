# MCP Generic Configuration Closure Design

**Status:** Implemented

## Goal

Close Task 17 with a vendor-neutral MCP server configuration model. Users can configure local STDIO and Streamable HTTP servers without Context7-, bearer-, or provider-specific configuration branches. Direct credential values are intentionally stored locally in `.mcp/servers.json`, which is Git-ignored.

## Scope

- Preserve existing project-level server definitions and harness-level mounts.
- Make configuration values explicit in MCP Studio.
- Support arbitrary STDIO environment variables and arbitrary HTTP headers.
- Keep existing legacy bearer-environment configurations readable.
- Do not add OAuth UI, server marketplace installation, call logs, or permission policy changes. Those belong to Task 18.

## Configuration Contract

All new server definitions use the same transport-neutral fields plus transport-specific fields:

```json
{
  "id": "context7",
  "name": "Context7",
  "description": "Developer documentation MCP server.",
  "transport": "stdio",
  "enabled": true,
  "env": {
    "CONTEXT7_API_KEY": "ctx7sk-example"
  },
  "command": "npx",
  "args": ["-y", "@upstash/context7-mcp"],
  "cwd": "."
}
```

```json
{
  "id": "remote-docs",
  "name": "Remote Docs",
  "transport": "streamable_http",
  "enabled": true,
  "headers": {
    "X-API-Key": "example-key",
    "Authorization": "Bearer example-token"
  },
  "url": "https://example.com/mcp"
}
```

`env` and `headers` are ordinary string-to-string maps. They may contain API keys, tokens, cookies, and custom provider fields. LLM Space does not interpret their names or impose a vendor-specific authentication model.

## Resolution Rules

### STDIO

The child process starts with a copy of `process.env`. Configured `server.env` entries overwrite same-named inherited values. Empty editor rows are omitted during normalization and never override inherited values.

```text
server.env explicit value > inherited process.env value > unset
```

This preserves the existing `echo` and `context7` definitions: since neither has `env` entries, they continue to inherit any shell-exported values exactly as before.

### Streamable HTTP

Configured `server.headers` are sent verbatim alongside the MCP-required `content-type` and `accept` headers. Header-name comparison is case-insensitive. A configured header wins over a default header with the same name; MCP-required protocol headers cannot be removed.

```text
server.headers explicit value > runtime default header > absent header
```

There is no special `Bearer` control. `Authorization: Bearer ...` is simply one header row.

## Legacy Compatibility

Older configs may contain:

```json
{
  "auth": { "type": "bearer", "env": "REMOTE_MCP_TOKEN" }
}
```

On read, the runtime resolves this legacy field only when no explicit `Authorization` header is configured. If the named process environment variable is present, it synthesizes `Authorization: Bearer <value>` for that request. New and edited configs are saved without `auth`; their equivalent must be represented in `headers` or, for stdio, `env`.

This migration is read-compatible and non-destructive: loading a legacy config does not rewrite it. It is normalized to the new persisted form only after the user saves that server.

## UI Design

MCP Studio keeps the existing compact server form and replaces the transport-specific authentication fields with explicit key-value editors:

- **STDIO:** Command, args, working directory, Environment.
- **Streamable HTTP:** URL, HTTP Headers.

Each editor supports adding and removing rows. Empty keys or empty values are excluded from the saved map. The form copy states that values are stored locally under `.mcp/`, excluded from Git, and that configured STDIO environment values override shell exports of the same name.

The Context7 preset stays credential-free. A user who wants authenticated Context7 can add `CONTEXT7_API_KEY` under Environment; no special Context7 code path exists.

## Boundaries

```text
MCP Studio -> server config store -> McpClient transport adapter -> MCP server
                         |                    |
                         |                    +-- STDIO: inherited env + configured env
                         +-- HTTP: configured headers + protocol defaults
```

`AgentExecutor`, tool schema adaptation, harness mounts, and tool names remain unchanged. They do not inspect authentication values.

## Error Handling And Safety

- Invalid map values are coerced to strings; blank keys and blank values are discarded.
- Duplicate header keys differing only in case are rejected by validation so request precedence is never ambiguous.
- Direct credentials remain in `.mcp/servers.json`; that directory remains Git-ignored.
- API responses return server definitions as currently designed. Because this is a local experimental platform, direct credentials are not redacted in the config editor; later secure-storage work is explicitly out of scope.

## Tests

- Config normalization preserves arbitrary `env` and `headers` maps.
- STDIO config values override inherited process values, while absent values preserve inheritance.
- HTTP sends arbitrary headers without requiring an `auth` type.
- Legacy bearer-env config still produces an Authorization header at runtime.
- Saving an edited legacy config writes only the generic new fields.
- Existing credential-free Echo and Context7 configs load unchanged.

## Acceptance Criteria

1. A user can configure any stdio server's environment variables in MCP Studio.
2. A user can configure any Streamable HTTP request headers in MCP Studio.
3. Context7 can be authenticated through the generic STDIO Environment editor.
4. Existing Echo and Context7 configurations continue to connect without modification.
5. Existing legacy bearer-env HTTP definitions still work until the user saves them.
6. No production code branches on a specific MCP server identity or API key name.
