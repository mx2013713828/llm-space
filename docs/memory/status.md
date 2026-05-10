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
  - 前端负责驱动 ReAct Loop。
  - 解析 LLM 响应，提取其中的 `tool_calls`，将工具请求发给后端执行，获取 `tool_result` 后再次提交给大模型，直到大模型不再使用工具。
  - **当前局限**：所有的工具执行是**串行**的。

### 2.3 后端工具系统 (Tool Layer)
后端在 `server/tools/` 目录下实现了多个内置工具模块：
- `bash.js`：执行 Shell 命令。
- `read_file.js` / `write_file.js`：直接读写文件。
- `weather_report.js`：天气查询 API 示例。
- `index.js` 中还包含 `write_todos` 等用于前端维护规划的工具实现。
- 提供统一接口 `POST /api/execute-tool` 供前端调用。

## 3. UI/UX 体验
- 分屏式操作界面，左侧面板包含“API 核心配置”（下拉切换与新增模型）、“Harness 文件管理器”。
- 右侧支持 `Prompt Lab` (提示词与能力挂载) 与 `运行轨迹` (查看 Agent 每一步推理与工具调用的详细过程)。
- 在 `MessageBubbles` 中优化了工具调用的折叠与参数展示。

## 4. 已知的瓶颈与风险
- **Context 溢出风险**：如果后端 `bash` 或 `read_file` 返回的内容过长，会直接导致发送给大模型的 Context 爆炸。
- **串行阻塞**：大模型在一个回复中同时调用的多个工具必须挨个执行，效率较低。
- **状态维护遗忘**：大模型在多步执行任务时，容易忘记调用 `write_todos` 更新状态。
- **系统安全性**：`bash` 工具目前可以直接在系统的当前目录下执行任何命令，缺乏文件系统隔离。
