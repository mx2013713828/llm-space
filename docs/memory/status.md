# LLM-Space 项目当前状态记录

## 1. 架构概览
- **前端框架**：React + Vite
- **后端框架**：Node.js + Express
- **核心定位**：Agent Harness 调试与运行平台，提供可插拔的系统提示词、工具与多模型测试环境，供初学者阶梯式学习Agent知识，理解LLM运行机制，可用于实际AI应用开发参考。

## 2. 核心模块与功能实现

### 2.1 状态与配置持久化
- **模型配置 (.env)**：将用户的 API Base URL、API Key、Model ID 等信息以 JSON 字符串形式持久化在 `.env` 文件中的 `MODELS_CONFIG` 环境变量里。后端提供 `/api/models` 接口进行读写。
- **会话保持 (Session State Lifting)**：`App.jsx` 作为状态最高层，维护了 `sessions` 对象。当用户在不同 Harness (Agent 配置文件) 之间切换时，各 Agent 的对话历史 (`messages`) 和任务列表 (`todos`) 得以无损保留。支持通过页面上的“🔄 重置 Session”按钮清空状态。

### 2.2 Agent Harness 与 ReAct Loop
- **Harness 配置体系**：所有的 Agent 配置（如 System Prompt、绑定的工具列表等）存放在 `harnesses/` 目录下的 JSON 文件中（例如 `01-chat-bot.json`, `02-deep-research.json`, `102-todos-without-reminder.json` 等）。
- **运行引擎 (TrajectoryPage)**：
  - 前端负责驱动 ReAct Loop，支持多轮递归直到大模型生成最终答案。
  - **协议完整性 (Protocol Integrity)**：采用原子块聚合算法，严格确保 `thinking`、`text`、`tool_use` 与随后的 `tool_result` 按照 Anthropic/DeepSeek API 要求的物理顺序对齐，彻底解决了深层递归导致的协议报错。
  - **并行执行支持**：已在后端实现 `executeToolsParallel`，能够同时分发多个工具调用。

### 2.3 后端工具系统 (Tool Layer)
- **流式执行引擎 (Streaming Engine)**：工具执行接口 `/api/execute-tool` 已升级为 SSE (Server-Sent Events) 流式架构。
- `bash.js`：从 `exec` 升级为 `spawn` 模式，支持实时捕获 stdout/stderr 并在前端动态渲染。

## 3. UI/UX 体验
- **终端体验 (Terminal Emulation)**：
  - 前端渲染器支持回车符 (`\r`) 的原地覆盖逻辑，完美展示 `pip/npm` 安装时的进度条。
  - 后端通过 TTY 伪装环境变量，强制激活工具的彩色输出与交互式行为。
- **实时监控 (Token Monitor)**：Thinking 气泡右上角实时显示当前推理轮次的 Input/Output Token 消耗统计。

## 4. 已知的瓶颈与风险
- **Context 溢出风险**：如果 `bash` 返回内容过长，仍可能导致 Context 爆炸。需引入摘要或截断机制。
- **后台任务缺失**：对于超过 2 分钟的极长任务，目前仍依赖 HTTP Keep-alive。需引入 Job 管理器与 `check_status` 异步工具。
- **安全性**：`bash` 缺乏沙盒化。

## 5. 最近工程突破 (Engineering Breakthroughs)
1. **原子块顺序聚合算法**：解决了 ReAct 循环中思维链丢失的难题。
2. **实时流式工具反馈**：将工具执行过程可视化，大幅降低了 Agent 运行时的黑盒感。
3. **终端进度条渲染**：通过处理控制字符，在 Web UI 中实现了近乎原生终端的安装进度反馈。
