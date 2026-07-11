# MCP Setup Guide

LLM Space supports MCP as an external tool provider layer. MCP servers are configured at the project level and mounted into a specific harness when you want the active agent to use those tools.

## What Is Supported

- STDIO MCP servers launched as local processes.
- Streamable HTTP MCP servers accessed through a URL.
- Context7 preset: `npx -y @upstash/context7-mcp`.
- Generic local Environment and HTTP Headers configuration. Values may be API keys, tokens, cookies, or provider-specific fields.
- Harness-level mounting with per-server tool allowlists.
- Tool names exposed to the model as `mcp__<serverId>__<toolName>`.

OAuth UI is intentionally not part of the first MVP. Authentication is configured through transport-neutral Environment and HTTP Header fields.

## Open MCP Studio

1. Start LLM Space:

   ```bash
   npm run dev
   ```

2. Open:

   ```text
   http://localhost:5174
   ```

3. Select the **MCP** tab.

The page shows configured servers, connection status, discovered tools, and the current harness mount.

## Test A Local MCP Server

The repository includes a tiny echo MCP server for testing:

```text
examples/mcp/echo-server.js
```

In MCP Studio, add a server:

```text
Name: Echo
ID: echo
Transport: STDIO
Command: node
Args:
examples/mcp/echo-server.js
CWD: .
```

Then:

1. Click **Save server**.
2. Select **Echo**.
3. Click **Connect**.
4. Verify that the `echo` tool appears.
5. Click **Test first tool**.
6. Mount the server into the current harness.

After mounting, the model sees:

```text
mcp__echo__echo
```

## Test Context7

Context7 is available as a preset.

1. In MCP Studio, find **Context7** under Presets.
2. Click `+`.
3. Select the new Context7 server.
4. Click **Connect**.

The command used is:

```bash
npx -y @upstash/context7-mcp
```

Context7 works anonymously with lower rate limits. To save an API key locally, edit the Context7 server and add this Environment row:

```text
Name: CONTEXT7_API_KEY
Value: ctx7sk-...
```

For STDIO servers, configured Environment values override same-named values inherited from the shell. If the row is absent, a previously exported `CONTEXT7_API_KEY` is inherited unchanged.

After tools are discovered, mount the server and ask the agent:

```text
Use Context7 to look up the latest React useEffect documentation.
```

## Test Streamable HTTP

Add a server:

```text
Name: Remote Docs
ID: remote-docs
Transport: Streamable HTTP
URL: https://example.com/mcp
```

Use **HTTP headers** for any authentication scheme or provider-specific field:

```text
Authorization: Bearer local-token
X-API-Key: local-api-key
CONTEXT7_API_KEY: ctx7sk-...
```

The editor saves these values locally as part of the MCP server definition. There is no provider-specific authentication selector.

## Where Configuration Lives

Project-level MCP servers:

```text
.mcp/servers.json
```

Harness-level mounts:

```text
.mcp/mounts/<harnessId>.json
```

This local-only directory is Git-ignored. Raw credentials may be saved there for an experimental local setup; do not copy or commit `.mcp/servers.json` elsewhere.

## Debugging

Use:

- MCP Studio to check connection status and discovered tools.
- Context Inspector to verify provider tool schemas.
- Trajectory view to inspect MCP tool calls and results.

If a tool does not appear in the model payload, check:

1. Server is connected.
2. Server is mounted into the current harness.
3. At least one tool is checked in the allowlist.
4. Context Inspector shows the MCP tool schema.
