[English](./README.md) | [简体中文](./README.zh-CN.md)

---

# LLM Space - 乐高式 AI Agent 可视化实验平台 🚀

[![Node Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-flat.svg?style=flat-square&color=339966)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-flat.svg?style=flat-square&color=blue)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-Welcome-flat.svg?style=flat-square&color=orange)](https://github.com/shareAI-lab/learn-claude-code/pulls)

> **“零抽象的白盒调试器，像拼乐高一样随心所欲搭建与测试你的 AI 代理。”**

**LLM Space** 是一个专为开发者设计的零框架抽象、可视化 AI Agent 乐高实验平台与工作台（IDE）。

许多重型 Agent 框架（如 LangChain）为了追求通用性引入了大量的黑盒封装与复杂的概念抽象，这给初学者的理解和开发者的本地调试带来了极高门槛。**LLM Space 坚持“所见即所得”与“极致轻量化”**，将 Agent 的决策、思考与工具调用轨迹完整呈现，并支持一键插拔高级特性。

---

## 🆕 最近更新 (Recent Updates)

* **2026-06-20：进程内定时任务调度器 MVP**
  - **Agent 自主管理任务**：通过 `schedule_cron`、`list_crons`、`cancel_cron` 创建、查看和取消当前 Harness 下的定时任务。
  - **持久化执行链路**：五字段 cron 表达式进入进程内事件队列，运行时解析最新模型配置，并复用现有 `AgentExecutor` 完成执行。
  - **可视化定时轨迹**：Scheduled Prompt、工具调用、最终回答、成功/失败次数和任务状态会显示在轨迹及 Scheduled Tasks 面板中。
  - **持久化执行历史**：最近的运行记录会保存开始/结束时间、耗时、结果和错误，并可在服务重启后继续查看。
  - **安全的后台执行**：Harness 忙碌时任务进入队列，避免并发 Agent Loop；前端通过 SSE 自动附着和 session 同步展示后台结果。

* **2026-06-13：可恢复的有向无环图任务系统 (DAG Task System) 🕸️**
  - **后端任务依赖流**：支持基于 DAG 的复杂任务系统，内置 Kahn 算法死锁检验、Claim 排他性文件锁并发保护、以及 Agent 异常崩溃退出时的物理看板租约自动回滚。
  - **缓存友好与去重装配**：重构插件 lifecycle (`preLLM`)。静动态状态 Diff 拆分注入以最大化提升模型 KV Cache（Prompt Cache）命中率，同时引入 XML 标签防重注入过滤。
  - **指引词自定义 UI (Prompt Lab)**：在实验特性中增加折叠手风琴卡片，高级用户可自定义修改 XML 指引词。支持文本垂直拉伸、长内容上下滚动、局部缓冲区安全暂存，以及一键重置默认指引。

---

## 🎬 整体交互演示

![LLM Space 整体操作演示](images/llm-space.gif)

---

## 📖 项目简介

**LLM Space** 是一个开源的、基于浏览器的可视化工作台，用于构建、调试和实验 AI Agent。与那些用层层抽象包裹一切的重量级 Agent 框架不同，LLM Space 将完整的执行生命周期——每一次思考、每一次工具调用、每一次响应——实时呈现在你眼前。

### 🎯 解决了什么痛点？

- **框架疲劳**：LangChain 等框架引入了成百上千个概念（Chains、Agents、Tools、Memory、Callbacks...），模糊了实际发生的一切。LLM Space 完全剥离框架抽象——你直接看到原始 HTTP 请求、流式响应和工具执行输出。
- **调试困难**：当 Agent 产生意外结果时，传统框架只给你一个最终答案，完全看不到决策路径。LLM Space 提供每一步的完整可视化轨迹。
- **配置繁琐**：切换 Agent 配置通常意味着编辑 YAML 文件并重启服务。LLM Space 支持一键热切换 Harness 预设，零等待。

### 👥 适合谁用？

- **AI/LLM 学习者**：想真正弄懂 Agent 底层工作原理的人
- **提示词工程师**：需要快速迭代 System Prompt 并获得即时可视化反馈
- **工具开发者**：想在 30 秒内原型并测试新的 Agent 能力
- **研究人员**：探索多 Agent 协作、DAG 任务拆解和 Agent 安全

### 📊 关键数据

- **5** 个内置 Harness 预设（从基础对话到 DAG 任务系统）
- **30 秒** 开发并注册一个自定义工具
- **3 分钟** 从零到运行你的第一个 Agent 实验
- **0** 框架依赖——纯 Node.js + 原生 JavaScript

## 💡 核心设计理念

### 🧱 乐高式插拔与配置 (Modular Sandbox)
我们把 Agent 复杂的生命周期解构为清晰的“积木结构”，全部支持在 UI 界面一键开启/禁用：
- **乐合底座 (Harness 宿主)**：使用极简的 `.json` 配置文件定义 Agent 的 System Prompt 预设与初始状态。在左侧面板秒级热切换。
- **可插拔功能插槽 (Modular Features)**：
  - **API 自愈与容灾 (Error Recovery)**：遇到 429 自动非阻塞指数退避重试、连续 529 自动 Failover 备用模型、`max_tokens` 截断自动无损续写物理拼接、死循环熔断。
  - **大模型语义重构 (Hard-Compact)**：上下文爆满时，自动触发紧急历史记忆压缩与 transcript 归档。
  - **实时缓存监控 (KV Cache Monitor)**：实时追踪 DeepSeek 等模型的 KV 缓存利用率。

### 👁️ 可视化白盒追踪 (White-Box Observability)
拒绝黑盒运行！所有细节尽收眼底：
- **思考链渲染**：原生支持 Anthropic Extended Thinking，流式渲染并折叠 `<thinking>` 思考轨迹。
- **工具调用轨迹**：直观展示 `tool_use` 发起、输入参数、工具本地真实执行输出（流式 Shell 输出、网页抓取等）的交互全过程。
- **消息物理合并**：续写流式打字与历史气泡无缝对齐，不产生逻辑断裂气泡。

---

## 🛠️ 快速启动 (3分钟极速上手)

### 1. 安装与运行
确保你的电脑上安装了 **Node.js** (推荐 v18+)，然后执行：
```bash
# 1. 安装依赖
npm install

# 2. 一键启动 (同时运行前端 UI 与后端服务)
npm run dev
```
启动后，浏览器会自动打开前端工作台：`http://localhost:5174`。

### 2. 环境变量配置 (.env)
在项目根目录创建 `.env` 文件（或参考 `.env.example`）：
```dotenv
# Tavily Search API — 用于网络搜索工具（https://tavily.com 免额度 1000次/月）
TAVILY_API_KEY=tvly-你的KEY

# 服务端口（可选，默认 3001）
PORT=3001
```
*(提示：大模型 API Key 可直接在前端 UI 左侧面板中动态添加，系统会自动将其存盘。)*

---

## 定时任务（Cron Scheduler MVP）

在 Harness 的实验特性中开启 **Cron Scheduler**，然后直接使用自然语言让 Agent 创建任务，例如：

```text
每 10 分钟查询一次临沂天气并播报。
```

开启后，Agent 会获得三个工具：

- `schedule_cron`：使用五字段 cron 表达式创建循环或单次任务。
- `list_crons`：查看任务及 queued/running/succeeded/failed 状态。
- `cancel_cron`：取消当前 Harness 所属的任务。

持久化任务定义保存在 `server/scheduler/tasks.json`，最近 500 条执行记录保存在 `server/scheduler/runs.json`。任务仅保存模型引用，不保存 API Key；每次执行时都会从 `.env` 解析最新的匹配模型配置。如果 Harness 正在运行，定时事件会排队等待，避免同时启动多个 Agent Loop。点击任务行的历史按钮可以查看运行状态、时间、耗时和错误。

MVP 边界：

- Cron 语法支持 `*`、`*/N`、固定值、范围和逗号分隔值。
- 任务使用服务器本地时区。
- 服务停止期间错过的任务不会补跑。
- 当前仅支持 `main` 执行模式；隔离会话、自动重试和告警将在后续阶段实现。

---

## 🔬 5 大基础 Harness 预设实验

我们为您预先创建了 5 个由浅入深的经典预设，可供您在左侧面板秒级切换并快速开始实验：

### 📁 01-chat-bot.json (基础对话)
* **定位**：理解最基础的 ReAct 工具调用循环。
* **特色**：挂载了简单的城市天气查询等工具。适合观察大模型分析城市、触发 tool_call、获取数据并自然语言归纳 of 闭环。
  <details>
  <summary>🔍 点击展开看运行演示 GIF</summary>

  ![01-chat-bot 演示](docs/images/01-chat-bot-demo.gif)

  </details>

### 📁 02-bash.json (系统交互)
* **定位**：让 Agent 拥有文件系统操作与网络探针大礼包。
* **特色**：挂载了真实的 Bash 执行器（流式回显）、文件读写、Tavily 实时网页搜索与抓取。你可以输入诸如“查找当前目录下最大的三个文件”来观察轨迹。
  <details>
  <summary>🔍 点击展开看运行演示 GIF</summary>

  ![02-bash 演示](docs/images/02-bash-demo.gif)

  </details>

### 📁 03-deep-research.json (深度调研)
* **定位**：学习 Agent 自动规划和拆解复杂任务。
* **特色**：结合 systemPrompt 中的 Behaviors 与本地 `write_todos`，大模型遇到复杂调研任务时会自动在右侧拆解出 4~8 个 TODO 步骤，并逐个攻克。
  <details>
  <summary>🔍 点击展开看运行演示 GIF</summary>

  ![03-deep-research 演示](docs/images/03-deep-research-demo.gif)

  </details>

### 📁 04-subagent.json (多 Agent 协作)
* **定位**：探索多 Agent 分工与上下文隔离。
* **特色**：挂载了 `sub_agent` 核心工具。主 Agent 在遇到繁重探针或庞大上下文搜集任务时，会主动派发任务并创建隔离的 Sub-agent 运行，最后接收并整合其汇报，避免当前主 context 溢出污染。
  <details>
  <summary>🔍 点击展开看运行演示 GIF</summary>

  ![04-subagent 演示](docs/images/04-subagent-demo.gif)

  </details>

### 📁 05-task-system.json (DAG 任务系统)
* **定位**：理解基于 DAG（有向无环图）的复杂长周期任务拆解与并发安全。
* **特色**：挂载了任务依赖系统工具（`create_task`, `list_tasks`, `claim_task`, `complete_task`）。内置 Kahn 算法环检测、Claim 排他性文件锁保护、以及崩溃自愈。Agent 遇到复杂多任务时，能像人类工程师一样自动拆解依赖、认领并逐个击破。
  <details>
  <summary>🔍 点击展开看运行演示 GIF</summary>

  ![05-task-system 演示](docs/images/05-task-system-demo.gif)

  </details>

---

## ⚙️ 乐高沙盒闭环交互 (如何自定义与导出)

在 LLM Space 中，你所做的任何实验调整都可以无缝沉淀：

1. **秒级插拔**：在左侧列表随意选中一个基础 Harness 后，在 **Prompt Lab** 中修改 Base System Prompt，勾选你想尝试的 Tools（如 `bash`, `sub_agent`），或者在实验特性区开启 `Error Recovery` 自愈开关。
2. **白盒追踪**：发送提问，观察轨迹追踪面板中展开的运行轨迹是否符合预期。
3. **一键存盘**：调试满意后，点击页面下方的 **“保存 (Save)”** 按钮。系统会立即在本地 `harnesses/` 目录下生成并导出您专属的全新 Harness JSON 配置文件，方便随用随切或与团队共享。

---

## 🔧 开发者进阶：30秒开发你的第一个 Tool 积木

如果你想让 Agent 拥有新的能力（例如执行数据库查询、或是调用自定义 API），只需两步：

### 第一步：在 `server/tools/` 目录下新建一个 JS 文件（例如 `hello_tool.js`）
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
    // 在这里编写真实的业务逻辑
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
**搞定！** 刷新前端页面，在 Prompt Lab 的 **🔧 Tools 挂载** 选项卡里勾选它即可使用。

---

## 🤝 参与贡献
欢迎大家共同完善这个 Agent 乐高沙盘！你可以通过以下方式参与：
- 提交你手写的有趣、有创意的 `Tools`（例如对接 Jira, Notion 等）；
- 提交新的 `Feature` 实验特性插件；
- 改进轨迹渲染界面的用户体验与微动画。

如果你觉得这个项目对你有帮助，请给项目点一个 **⭐ Star**，这对于开源作者是最大的鼓励！
