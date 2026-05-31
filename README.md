# LLM Space - 乐高式 AI Agent 可视化实验平台 🚀

[![Node Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-flat.svg?style=flat-square&color=339966)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-flat.svg?style=flat-square&color=blue)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-flat.svg?style=flat-square&color=orange)](https://github.com/shareAI-lab/learn-claude-code/pulls)

> **“零抽象的白盒调试器，像拼乐高一样随心所欲搭建与测试你的 AI 代理。”**

**LLM Space** 是一个专为开发者设计的零框架抽象、可视化 AI Agent 乐高实验平台与工作台（IDE）。

许多重型 Agent 框架（如 LangChain）为了追求通用性引入了大量的黑盒封装与复杂的概念抽象，这给初学者的理解和开发者的本地调试带来了极高门槛。**LLM Space 坚持“所见即所得”与“极致轻量化”**，将 Agent 的决策、思考与工具调用轨迹完整呈现，并支持一键插拔高级特性。

---

## 💡 核心设计理念

### 🧱 乐高式插拔与配置 (Modular Sandbox)
我们把 Agent 复杂的生命周期解构为清晰的“积木结构”，全部支持在 UI 界面一键开启/禁用：
- **乐高底座 (Harness 宿主)**：使用极简的 `.json` 配置文件定义 Agent 的 System Prompt 预设与初始状态。在左侧面板秒级热切换。
- **可插拔功能插槽 (Modular Features)**：
  - **API 自愈与容灾 (Error Recovery)**：遇到 429 自动非阻塞指数退避重试、连续 529 自动 Failover 备用模型、`max_tokens` 截断自动无损续写物理拼接、死循环熔断。
  - **大模型语义重构 (Hard-Compact)**：上下文爆满时，自动触发紧急历史记忆压缩与 transcript 归档。
  - **实时缓存监控 (KV Cache Monitor)**：实时追踪 DeepSeek 等模型的 KV 缓存命中率与利用率。

### 👁️ 可视化白盒追踪 (White-Box Observability)
拒绝黑盒运行！所有细节尽收眼底：
- **思考链渲染**：原生支持 Anthropic Extended Thinking，流式渲染并折叠 `<thinking>` 思考轨迹。
- **工具调用轨迹**：直观展示 `tool_use` 发起、输入参数、工具本地真实执行输出（流式 Shell 输出、网页抓取等）的交互全过程。
- **消息物理合并**：续写流式打字与历史气泡无缝对齐，不产生逻辑断裂气泡。

### 🎯 从零基础到高阶玩家的 Playground
- **对于新手 (Zero to Hero)**：
  通过直观的视觉轨迹，零门槛看清 `LLM 思考 -> 触发工具调用 -> 本地真实执行 -> 结果流式回传 -> 下一轮循环决策` 的 ReAct 原理，无需配置高深复杂的代理类。
- **对于高阶玩家 (Agent Craftsman)**：
  - **随心所欲拼装**：在 UI 界面上自由勾选要挂载给大模型的 Tools 积木，在线修改 Base System Prompt。
  - **极速自定义扩展**：没有任何繁琐的类继承和包装。只需编写几十行纯 Node.js 代码，即可把本地的任意脚本（Bash、Python、DB 查询）转化为 Agent 挂载的 Tool 积木。

---

## ✨ 核心特性

- **多轮自主 Agent 循环**：全自动流式解析与渲染多轮工具迭代交互。
- **真实的系统工具调用**：内建代理服务器，真实执行 Bash 脚本、读写文件、连接 Open-Meteo 天气 API，以及通过 Tavily 进行网络搜索与网页抓取。
- **Harness 资源管理器**：左侧面板动态读取 `harnesses/` 目录下的 `.json` 配置，秒级热切换和测试。
- **Prompt Lab 沉浸式编辑**：支持在线修改 System Prompt，直接勾选工具，并支持一键 `保存到本地 JSON`。
- **全兼容 API 代理层**：后端使用 Express 构建了兼容 Anthropic 协议的代理层，彻底解决浏览器跨域（CORS）问题，并动态适配 DeepSeek 接口（思考模式自动启停、budget_tokens 取整适配）。
- **自动代理检测**：服务端自动识别系统 `HTTPS_PROXY` 环境变量，fetch 请求自动走代理。

---

## 🛠️ 快速启动 (3分钟极速上手)

### 1. 环境准备
确保你的电脑上安装了 **Node.js** (推荐 v18+)。

### 2. 安装依赖
```bash
npm install
```

### 3. 一键启动
本项目配置了 `concurrently`，一个命令即可同时启动 **前端 UI** 和 **后端代理服务**：
```bash
npm run dev
```
运行成功后：
- **后端 API 服务** 运行在：`http://localhost:3001`
- **前端工作台** 运行在：`http://localhost:5174` (浏览器会自动或需手动打开该地址)

### 4. 环境变量配置 (.env)
在项目根目录创建 `.env` 文件（或参考 `.env.example`）：
```dotenv
# Tavily Search API — 用于网络搜索工具（https://tavily.com 免额度 1000次/月）
TAVILY_API_KEY=tvly-你的KEY

# 服务端口（可选，默认 3001）
PORT=3001
```
*(提示：模型配置和 Key 可直接在前端 UI 中进行动态添加，系统会自动将其存盘。)*

---

## 🔧 乐高扩展：30秒开发你的第一个 Tool 积木

如果你想让 Agent 拥有新的能力（例如执行数据库查询、或是调用自定义 API），只需两步：

### 第一步：在 `server/tools/` 目录下新建一个 JS 文件（例如 `hello_tool.js`）
导出一个包含 `name`、`description`、`parameters` (符合 JSON Schema 规范) 和 `execute` 函数的对象：

```javascript
// server/tools/hello_tool.js
export default {
  name: 'hello_tool',
  description: '向指定的用户发送问候，并附加一条自定义消息。',
  parameters: {
    type: 'object',
    properties: {
      userName: { type: 'string', description: '接收问候的用户名' },
      customMsg: { type: 'string', description: '附加的自定义祝福消息' }
    },
    required: ['userName']
  },
  async execute({ userName, customMsg = '祝你开心！' }) {
    // 这里可以编写任何真实的业务逻辑，比如查询数据库、执行 Bash 等
    return `你好，${userName}！ ${customMsg}`;
  }
};
```

### 第二步：在 `server/tools/index.js` 中引入并注册
```javascript
// server/tools/index.js
import hello_tool from './hello_tool.js';

export const tools = [
  // ... 其他工具
  hello_tool
];
```

**搞定！** 刷新前端页面，在 Prompt Lab 的 **🔧 Tools 挂载** 选项卡里勾选 `hello_tool`，大模型便即刻拥有了向用户发送问候的能力。

---

## 📂 核心目录结构

```text
llm-space/
├── harnesses/                 # Agent 配置文件目录（JSON 格式，宿主）
├── server.js                  # 后端代理与工具调度服务器 (Express)
├── server/
│   └── tools/                 # 后端真实工具库（乐高积木）
│       ├── index.js           # 工具注册中心
│       ├── bash.js            # 真实的 Shell 执行器
│       ├── web_search.js      # Tavily 网络搜索
│       └── ...                
├── src/                       # React 前端源码 (白盒轨迹)
│   ├── components/            # UI 组件（对话气泡、Todo 列表等）
│   ├── pages/
│   │   ├── TrajectoryPage.jsx # 运行轨迹追踪与 Agent Loop 引擎
│   │   └── PromptLabPage.jsx  # Prompt/工具 配置工作台
│   └── App.jsx                # 应用入口与资源管理器
└── package.json
```

---

## 🤝 参与贡献
欢迎大家共同完善这个 Agent 乐高沙盘！你可以通过以下方式参与：
- 提交你手写的有趣、有创意的 `Tools`（例如对接 Jira, Notion 等）；
- 提交新的 `Feature` 实验特性插件；
- 改进轨迹渲染界面的用户体验与微动画。

如果你觉得这个项目对你有帮助，请给项目点一个 **⭐ Star**，这对于开源作者是最大的鼓励！
