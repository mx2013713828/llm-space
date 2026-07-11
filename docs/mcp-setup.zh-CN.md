# MCP 配置指南

LLM Space 将 MCP 作为外部工具提供层。MCP server 是项目级配置；当你希望当前 harness 的 Agent 使用这些工具时，再把 server 或部分工具挂载到 harness。

## 当前支持

- STDIO MCP server：作为本地进程启动。
- Streamable HTTP MCP server：通过 URL 访问。
- Context7 预设：`npx -y @upstash/context7-mcp`。
- 通用本地 Environment 与 HTTP Headers 配置，可填写 API Key、Token、Cookie 或 provider 特有字段。
- Harness 级挂载与按工具 allowlist 选择。
- 暴露给模型的工具名格式：`mcp__<serverId>__<toolName>`。

第一版暂不做 OAuth UI。认证统一通过 Environment 与 HTTP Headers 配置，不绑定具体 provider。

## 打开 MCP Studio

1. 启动项目：

   ```bash
   npm run dev
   ```

2. 打开：

   ```text
   http://localhost:5174
   ```

3. 进入 **MCP** 标签页。

页面会展示已配置 server、连接状态、已发现工具和当前 harness 的挂载状态。

## 测试本地 MCP Server

仓库内置了一个极简 echo MCP server：

```text
examples/mcp/echo-server.js
```

在 MCP Studio 中添加 server：

```text
Name: Echo
ID: echo
Transport: STDIO
Command: node
Args:
examples/mcp/echo-server.js
CWD: .
```

然后：

1. 点击 **Save server**。
2. 选择 **Echo**。
3. 点击 **Connect**。
4. 确认出现 `echo` 工具。
5. 点击 **Test first tool**。
6. 将 server 挂载到当前 harness。

挂载后，模型可以看到：

```text
mcp__echo__echo
```

## 测试 Context7

Context7 已作为预设内置。

1. 在 MCP Studio 的 Presets 中找到 **Context7**。
2. 点击 `+`。
3. 选择新添加的 Context7 server。
4. 点击 **Connect**。

实际执行的命令是：

```bash
npx -y @upstash/context7-mcp
```

Context7 匿名模式可用，但额度较低。若要将 API Key 本地保存，编辑 Context7 server，在 **Environment** 中新增：

```text
Name: CONTEXT7_API_KEY
Value: ctx7sk-...
```

对于 STDIO server，Studio 中配置的 Environment 会覆盖 shell 中同名的 `export` 值；如果未配置该项，则保持继承 shell 环境变量的现有行为。

发现工具后，将 server 挂载到当前 harness，然后询问：

```text
使用 Context7 查询 React useEffect 的最新文档。
```

## 测试 Streamable HTTP

添加 server：

```text
Name: Remote Docs
ID: remote-docs
Transport: Streamable HTTP
URL: https://example.com/mcp
```

任何认证方式或 provider 专属字段都使用 **HTTP Headers**：

```text
Authorization: Bearer local-token
X-API-Key: local-api-key
CONTEXT7_API_KEY: ctx7sk-...
```

编辑器会将这些值作为 MCP server 配置的一部分本地保存，不再提供与厂商绑定的认证下拉框。

## 配置保存在哪里

项目级 MCP server：

```text
.mcp/servers.json
```

Harness 级挂载：

```text
.mcp/mounts/<harnessId>.json
```

该目录仅本地使用且已被 Git ignore。实验平台允许在其中保存原始密钥，但不要复制或提交 `.mcp/servers.json` 到其他位置。

## 调试方式

使用：

- MCP Studio 查看连接状态和已发现工具。
- Context Inspector 确认 provider tool schema。
- Trajectory 查看 MCP 工具调用和结果。

如果模型看不到工具，检查：

1. Server 是否已连接。
2. Server 是否挂载到当前 harness。
3. 是否至少勾选了一个工具。
4. Context Inspector 中是否出现 MCP tool schema。
