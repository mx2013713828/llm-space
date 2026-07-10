# MCP Runtime Mounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an MCP management and mounting experience that can connect user-authored MCP servers, connect Context7, expose discovered MCP tools to the active harness, and make the full runtime visible.

**Architecture:** MCP is an external tool provider layer. Project-level MCP server definitions are stored separately from harness-level mounts; discovered MCP tools are adapted into the existing Runtime Tool Pool and dispatched through the existing AgentExecutor tool execution path.

**Tech Stack:** Node.js ESM, Express routes, JSON-RPC over stdio/streamable HTTP, React, existing harness feature schema, node:test.

## Global Constraints

- MVP supports `stdio` and `streamable_http` transport names.
- MCP tool names must be namespaced as `mcp__<serverId>__<toolName>`.
- Project-level MCP server definitions live under `.mcp/servers.json`; harness-level mounts live in harness features.
- Context7 must be available as a preset using `npx -y @upstash/context7-mcp`.
- The UI must behave like Tools Mounting: configure, connect, test, mount, inspect.
- Agent-assisted installation must never silently run install commands without user-visible confirmation.
- Context Inspector must show mounted MCP servers and provider tool schemas.

---

### Task 1: MCP Core Config and Tool Adapter

**Files:**
- Create: `server/mcp/mcpNames.js`
- Create: `server/mcp/mcpConfigStore.js`
- Create: `server/mcp/mcpToolAdapter.js`
- Test: `server/mcp/mcpNames.test.js`
- Test: `server/mcp/mcpConfigStore.test.js`
- Test: `server/mcp/mcpToolAdapter.test.js`

**Interfaces:**
- Produces: `normalizeMcpName(value: string): string`
- Produces: `buildMcpToolName(serverId: string, toolName: string): string`
- Produces: `parseMcpToolName(name: string): { serverId: string, toolName: string } | null`
- Produces: `listMcpServers({ rootDir, fsImpl }): Promise<Array<McpServerConfig>>`
- Produces: `saveMcpServers({ servers, rootDir, fsImpl }): Promise<Array<McpServerConfig>>`
- Produces: `adaptMcpTool({ server, tool }): InternalToolDefinition`

- [x] Write failing tests for name normalization, config defaults, Context7 preset shape, and schema adaptation.
- [x] Implement config read/write with safe defaults and `.mcp/servers.json`.
- [x] Implement MCP tool naming and adapter metadata.
- [x] Run focused tests.

### Task 2: MCP Client and Manager

**Files:**
- Create: `server/mcp/mcpJsonRpc.js`
- Create: `server/mcp/mcpClient.js`
- Create: `server/mcp/mcpManager.js`
- Create: `examples/mcp/echo-server.js`
- Test: `server/mcp/mcpJsonRpc.test.js`
- Test: `server/mcp/mcpManager.test.js`

**Interfaces:**
- Produces: `McpClient.connect()`, `McpClient.listTools()`, `McpClient.callTool(name, args)`, `McpClient.disconnect()`
- Produces: `McpManager.connectServer(serverId)`, `McpManager.refreshTools(serverId)`, `McpManager.callTool(toolName, input)`

- [x] Write failing tests with a local echo MCP server.
- [x] Implement stdio JSON-RPC client.
- [x] Implement minimal streamable HTTP JSON-RPC calls.
- [x] Implement manager state, connection status, tool discovery, and tool call routing.
- [x] Run focused tests.

### Task 3: Runtime Tool Pool Integration

**Files:**
- Modify: `server/tools/ToolRegistry.js`
- Modify: `server/tools/index.js`
- Modify: `server/agent/toolPool.js`
- Modify: `server/agent/runtimeRequest.js`
- Modify: `server/routes/agentRunRoutes.js`
- Modify: `server/routes/harnessRoutes.js`
- Test: `server/agent/toolPool.test.js`
- Test: `server/routes/harnessRoutes.test.js`

**Interfaces:**
- Consumes: `McpManager`
- Produces: dynamic registry support for MCP tools
- Produces: dry-run provider schema contains mounted MCP tools

- [x] Write failing tests for mounted MCP tools entering the tool pool.
- [x] Add `mcp` feature parsing via existing feature schema.
- [x] Pass mounted MCP tool definitions into dry-run and agent execution.
- [x] Route `mcp__...` execution to `McpManager.callTool`.
- [x] Run focused tests.

### Task 4: MCP Routes

**Files:**
- Create: `server/routes/mcpRoutes.js`
- Modify: `server/app/createServerApp.js`
- Test: `server/routes/mcpRoutes.test.js`

**Interfaces:**
- Produces: `GET /api/mcp/servers`
- Produces: `POST /api/mcp/servers`
- Produces: `PATCH /api/mcp/servers/:serverId`
- Produces: `DELETE /api/mcp/servers/:serverId`
- Produces: `POST /api/mcp/servers/:serverId/connect`
- Produces: `POST /api/mcp/servers/:serverId/refresh-tools`
- Produces: `POST /api/mcp/servers/:serverId/test-tool`
- Produces: `GET /api/harnesses/:harnessId/mcp`
- Produces: `POST /api/harnesses/:harnessId/mcp`

- [x] Write route tests for list/create/connect/mount.
- [x] Register MCP routes in server app.
- [x] Add preset endpoint data including Context7.
- [x] Run route tests.

### Task 5: MCP Studio UI

**Files:**
- Create: `src/pages/McpPage.jsx`
- Create: `src/lib/mcpServers.js`
- Modify: `src/App.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: MCP routes.
- Produces: top-level MCP page with configured servers, add server form, connection/test controls, and harness mount controls.

- [x] Implement API helpers.
- [x] Add MCP top-level tab.
- [x] Implement server list, detail panel, Context7 preset add, stdio/http forms.
- [x] Implement current harness mounted tool selection.
- [x] Run build.

### Task 6: Docs and Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create: `docs/mcp-setup.md`
- Create: `docs/mcp-setup.zh-CN.md`

**Interfaces:**
- Produces: user testing guide for custom echo MCP and Context7.

- [x] Document setup and testing steps.
- [x] Run full test suite.
- [x] Commit final result.

