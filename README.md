# LLM Space - Agent Harness 🚀

**LLM Space** 是一个专为开发、调试和测试大语言模型（LLM）自主代理（Autonomous Agent）而设计的实验平台与工作台（IDE）。它支持多轮循环、真实的系统工具调用以及实时的 Prompt 配置。

在这个平台上，你可以像管理代码一样管理 Agent 的系统指令（System Prompt）和技能挂载（Tools/Skills），并直观地观测大模型的思考过程和工具执行轨迹。

---

## ✨ 核心特性

- **多轮自主 Agent 循环**：支持 Anthropic Extended Thinking 机制，完整解析并渲染 `<thinking>` 思考链。自动捕捉 `tool_use`，执行工具后将结果自动传回给模型进行多轮流式对话。
- **真实的系统工具调用**：内建代理服务器，真实执行 Bash 脚本、读写文件、连接 Open-Meteo 天气 API，以及通过 Tavily 进行网络搜索与网页抓取。
- **Harness 资源管理器**：左侧面板动态读取 `harnesses/` 目录下的 `.json` 配置，方便你快速切换和测试不同设定的 Agent。
- **Prompt Lab 沉浸式编辑**：支持在线修改 System Prompt，直接在界面勾选要挂载给大模型的标准工具，并支持一键 `保存到本地 JSON`。
- **全兼容的 API 代理层**：后端使用 Express 构建了兼容 Anthropic 协议的代理层，彻底解决浏览器跨域（CORS）问题，并动态适配 DeepSeek 接口（思考模式自动启停、budget_tokens 取整适配）。
- **实时缓存命中监控**：界面右侧面板实时显示 DeepSeek KV Cache 命中率，直观评估上下文缓存的利用效率。
- **自动代理检测**：服务端自动识别系统 `HTTPS_PROXY` 环境变量，通过 `undici` 全局分发，所有 fetch 请求自动走代理。

---

## 🛠️ 如何启动项目

### 1. 环境准备
确保你的电脑上安装了 **Node.js** (推荐 v18+)。

### 2. 安装依赖
在项目根目录执行以下命令，安装前端和后端所需的所有依赖包：
```bash
npm install
```

### 3. 一键启动
本项目配置了 `concurrently`，你只需要运行一个命令，即可同时启动 **前端 UI** 和 **后端代理服务器**：
```bash
npm run dev
```

运行成功后，终端会提示：
- **后端 API 服务** 运行在：`http://localhost:3001`
- **前端工作台** 运行在：`http://localhost:5174` (浏览器会自动或需手动打开该地址)

### 4. 环境配置 (.env)

在项目根目录的 `.env` 文件中配置 API 密钥：

```dotenv
# 模型配置（可通过 UI 添加，自动写入）
MODELS_CONFIG=[{"name":"dsp-v4-pro","modelId":"deepseek-v4-pro","url":"...","key":"sk-...","id":"..."}]

# Tavily Search API — 网络搜索工具（https://tavily.com）
# 免费额度 1000 次/月，注册即可获取
TAVILY_API_KEY=tvly-你的KEY

# 服务端口（可选，默认 3001）
PORT=3001
```

---

## 📂 核心目录结构

```text
llm-space/
├── harnesses/                 # Agent 配置文件存放目录（JSON 格式）
│   ├── 01-chat-bot.json
│   ├── 02-deep-research.json
│   └── 102-todos-without-reminder.json
├── server.js                  # 后端代理与工具调度服务器 (Express)
├── server/
│   └── tools/                 # 后端真实工具库
│       ├── index.js           # 工具注册中心 (导出给大模型的 Schema)
│       ├── bash.js            # 真实的 Shell 执行器（流式输出）
│       ├── read_file.js       # 本地文件读取器
│       ├── write_file.js      # 本地文件写入器
│       ├── write_todos.js     # TODO 任务列表管理
│       ├── weather_report.js  # 真实调用的 Open-Meteo 天气 API
│       ├── web_search.js      # Tavily 网络搜索（AI 摘要 + 结构化结果）
│       └── web_fetch.js       # Tavily 网页抓取（清洗为 Markdown 正文）
├── src/                       # React 前端源码
│   ├── components/            # UI 组件（对话气泡、Todo 列表等）
│   ├── pages/
│   │   ├── TrajectoryPage.jsx # 运行轨迹追踪与 Agent Loop 引擎
│   │   └── PromptLabPage.jsx  # Prompt/工具 配置工作台
│   └── App.jsx                # 整体应用入口与左侧资源管理器
└── package.json
```

---

## 🔧 如何开发一个新工具？

本框架采用标准化的 Claude JSON Schema 规范来管理工具。如果你想让 Agent 拥有新的能力（比如操作数据库）：

1. 在 `server/tools/` 目录下新建一个文件（例如 `query_db.js`）。
2. 参考现有工具，导出一个包含 `name`, `description`, `parameters` 和 `execute()` 异步执行函数的对象。
3. 如果需要 API Key 等敏感配置，在 `.env` 中添加对应的环境变量，工具中通过 `process.env.XXX` 读取。
4. 在 `server/tools/index.js` 中引入该文件并注册到 `tools` 集合中。
5. 刷新前端页面，在 Prompt Lab 的 **🔧 Tools 挂载** 选项卡里勾选它即可。
