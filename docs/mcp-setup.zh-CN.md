# MCP 配置指南

LLM Space 将 MCP 作为外部工具提供层。MCP server 是项目级配置；当你希望当前 harness 的 Agent 使用这些工具时，再把 server 或部分工具挂载到 harness。

## 当前支持

- STDIO MCP server：作为本地进程启动。
- Streamable HTTP MCP server：通过 URL 访问。
- Context7 预设：`npx -y @upstash/context7-mcp`。
- 通用本地 Environment 与 HTTP Headers 配置，可填写 API Key、Token、Cookie 或 provider 特有字段。
- Harness 级挂载与按工具 allowlist 选择。
- 明确的运行状态：starting、connected、error、stopped。
- 安全的认证证据：匿名、凭证已配置、调用已验证、凭证无效。
- Harness、server、tool 三层 MCP 审批策略。
- 有界且脱敏的最近调用摘要，详情按需加载。
- 暴露给模型的工具名格式：`mcp__<serverId>__<toolName>`。

当前版本暂不做 OAuth UI。配置模型为未来 OAuth transport adapter 保留了来源类型，但暂不会发起浏览器授权、刷新令牌或保存 OAuth token；认证仍统一通过 Environment 与 HTTP Headers 配置，不绑定具体 provider。

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

## 运行状态与安全诊断

点击 **Connect** 后界面会立即显示 `Starting`；只有初始化和工具发现都成功后才会变为 `Connected`。失败会进入 `Error`，并显示 `timeout`、`initialize_failed`、`authentication_failed`、`process_exited` 等结构化分类。

Studio 只展示有长度上限的诊断尾部，配置中的明文凭证会在进入 UI 前脱敏。认证状态表示运行证据，而不是凭证查看器：

- **Anonymous**：没有配置凭证绑定。
- **Credential configured**：存在直接值或环境变量引用。
- **Verified**：当前 server 进程已有成功工具调用。
- **Invalid credential**：运行时收到了 HTTP 401 或 403。

使用 **Disconnect** 可以终止托管的 STDIO 子进程，或清理当前 HTTP client 状态。最近调用只保留工具名、参数键名、耗时、成功/失败状态和有界输出预览；完整参数、header、密钥不会写入运行日志。

## 审批策略

每个 harness 挂载都有一个默认策略，还可以按 server、按 tool 覆盖：

```text
tool override > server override > harness default
```

- **Auto read-only**（默认）：只有明确标注 `readOnlyHint: true` 的工具可以直接运行。没有标注的工具会 fail-closed，进入现有审批弹窗。
- **Ask every call**：每次 MCP 调用均使用现有审批弹窗。
- **Auto allow**：在该作用域跳过 MCP 专属审批。

策略属于 harness 挂载，而不是 server 定义。同一个 server 因此可以在临时实验 harness 中宽松运行，在代码 harness 中始终要求审批。全局硬安全策略仍然优先。

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

Context Inspector 还会显示 **MCP Mount Policy** 运行时元数据摘要；它只用于可观测性，不会被拼入模型 prompt。
