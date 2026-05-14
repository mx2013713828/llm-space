# LLM-Space 项目当前状态记录

## 1. 架构概览
- **前端框架**：React + Vite
- **后端框架**：Node.js + Express (SSE 全流式)
- **核心定位**：Agent Harness 调试与运行平台，提供可插拔的系统提示词、工具与多模型测试环境，供初学者阶梯式学习Agent知识，理解LLM运行机制，可用于实际AI应用开发参考。

## 2. 核心模块与功能实现

### 2.1 状态与配置持久化
- **模型配置 (.env)**：将用户的 API Base URL、API Key、Model ID 等信息以 JSON 字符串形式持久化在 `.env` 文件中的 `MODELS_CONFIG` 环境变量里。后端提供 `/api/models` 接口进行读写。
- **环境变量自动加载**：服务端启动时解析 `.env` 所有键值到 `process.env`（支持注释、空行），工具可直接通过 `process.env.XXX` 读取敏感配置（如 `TAVILY_API_KEY`）。`PORT` 也优先从 `.env` 读取。
- **会话保持 (Session State Lifting)**：`App.jsx` 作为状态最高层，维护了 `sessions` 对象。当用户在不同 Harness 之间切换时，各 Agent 的对话历史 (`messages`) 和任务列表 (`todos`) 得以无损保留。支持通过"🔄 重置 Session"按钮清空状态。

### 2.2 Agent Harness 与 ReAct Loop
- **Harness 配置体系**：所有的 Agent 配置存放在 `harnesses/` 目录下的 JSON 文件中（如 `01-chat-bot.json`, `02-deep-research.json`, `102-todos-without-reminder.json`）。
- **运行引擎 (TrajectoryPage)**：
  - 前端负责驱动 ReAct Loop，支持多轮递归直到大模型生成最终答案。
  - **协议完整性 (Protocol Integrity)**：采用原子块聚合算法，严格确保 `thinking`、`text`、`tool_use` 与随后的 `tool_result` 按照 Anthropic/DeepSeek API 要求的物理顺序对齐。
  - **并行执行支持**：已在后端实现 `executeToolsParallel`，能够同时分发多个工具调用。
  - **TODO 状态注入**：每轮自动将任务看板注入消息序列末尾，支持催促机制（连续 3 轮未更新 TODO 时提醒）。

### 2.3 多模型适配
- **DeepSeek 思考模式兼容**：DeepSeek 的 `thinking` 参数支持 `enabled` / `disabled` 双向开关。`budget_tokens` 需取整（浮点数会被 DeepSeek 拒绝）。DeepSeek 不使用 signature 签名机制，thinking 块无需密码学验证即可在多轮对话中传递。
- **思考模式热插拔**：同一对话中可随时开关思考模式。开启时 thinking 块保留在消息中，关闭时 `buildApiMessages` 自动过滤旧 thinking 块。
- **KV Cache 监控**：DeepSeek 默认开启上下文硬盘缓存，自动检测公共前缀并落盘。服务端透传 `cache_read_input_tokens` 字段，前端实时显示缓存命中率（`💾 XX% 命中`）。

### 2.4 后端工具系统 (Tool Layer)
- **工具注册中心**：`server/tools/index.js` 统一管理，导出 `getToolSchemas()` 和 `executeTool()`。
- **流式执行引擎 (Streaming Engine)**：工具执行接口 `/api/execute-tool` 使用 SSE 流式架构。
- **工具列表**：

| 工具 | 文件 | 能力 |
|------|------|------|
| `bash` | `bash.js` | Shell 执行，`spawn` 模式实时流式输出，120s 超时 |
| `read_file` | `read_file.js` | 读取本地文件 |
| `write_file` | `write_file.js` | 写入本地文件 |
| `weather_report` | `weather_report.js` | 调用 Open-Meteo 真实天气 API |
| `write_todos` | `write_todos.js` | TODO 任务列表管理（前端拦截更新） |
| `web_search` | `web_search.js` | Tavily `/search` — 关键词搜索，返回 AI 摘要 + 结构化结果 |
| `web_fetch` | `web_fetch.js` | Tavily `/extract` — 传入 URL，返回清洗后 Markdown 正文 |

### 2.5 网络代理支持
- 使用 `undici` 的 `EnvHttpProxyAgent` + `setGlobalDispatcher` 全局适配。
- 自动读取系统 `HTTPS_PROXY` 环境变量，无需额外配置。
- 所有 `fetch` 请求（包括 LLM API、天气 API、Tavily）自动走代理。

### 2.6 容错与重试
- 上游 API 请求失败时自动重试 3 次（间隔 1s）。
- 错误日志包含 endpoint URL 和具体 cause 信息。

## 3. UI/UX 体验
- **终端体验 (Terminal Emulation)**：前端渲染器支持 `\r` 原地覆盖，完美展示进度条。后端通过 TTY 伪装环境变量强制工具彩色输出。
- **实时监控 (Token Monitor)**：Thinking 气泡右上角实时显示 Input/Output Token 消耗。
- **缓存命中监控**：右侧面板顶部显示 KV Cache 命中率，hover 展示命中/未命中 token 数。
- **模型管理 UI**：左侧面板支持通过表单直接添加新模型配置并持久化到 `.env`。

## 4. 已知的瓶颈与风险
- **Context 溢出风险**：如果 `bash` 或 `web_fetch` 返回内容过长，仍可能导致 Context 爆炸。需引入摘要或截断机制。
- **后台任务缺失**：超过 2 分钟的极长任务仍依赖 HTTP Keep-alive。需引入 Job 管理器。
- **安全性**：`bash` 缺乏沙盒化。
- **web_fetch 内容截断**：Tavily `/extract` 对超长页面会截断，需评估最大可接受长度。

## 5. 最近工程突破 (Engineering Breakthroughs)
1. **原子块顺序聚合算法**：解决了 ReAct 循环中思维链丢失的难题。
2. **实时流式工具反馈**：将工具执行过程可视化，大幅降低了 Agent 运行时的黑盒感。
3. **终端进度条渲染**：通过处理控制字符，在 Web UI 中实现了近乎原生终端的安装进度反馈。
4. **DeepSeek 思考模式全适配**：修复 thinking 块字段名不匹配、budget_tokens 浮点拒绝、thinking 参数缺失导致 400 等一系列模型兼容问题，实现双向热插拔。
5. **Tavily 网络搜索集成**：从模拟执行升级为真实 API 调用，Agent 具备实时互联网搜索与网页抓取能力。
6. **全局代理自动适配**：通过 `undici` 全局分发，解决 Node.js fetch 不认 `HTTPS_PROXY` 导致的网络超时问题。
