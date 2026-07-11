[English](./README.md) | [简体中文](./README.zh-CN.md)

# LLM Space

[![Node Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-flat.svg?style=flat-square&color=339966)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-flat.svg?style=flat-square&color=blue)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-node%20--test-blue.svg?style=flat-square)](./package.json)

> 零抽象的白盒调试器，像拼乐高一样随心所欲搭建与测试你的 AI 代理。

LLM Space 是一个面向开发者的可视化 AI Agent Harness 实验平台与工作台。它不是重型 Agent 框架，也不追求把所有决策封装成黑盒。相反，它把运行循环、prompt 组装、模型 payload、工具调用、记忆、任务编排、知识检索、子代理行为都尽量展开，让你能看见并修改一个 Agent 是如何被组装出来的。

许多 Agent 框架为了追求通用性引入大量黑盒封装和概念抽象。LLM Space 选择相反方向：Agent 看到了什么、思考了什么、调用了什么、检索了什么、最终发给模型什么，都应该可观察、可替换、可调试。

项目原则很简单：保持实验性、可观察、可拆卸。用户可以从最小 ReAct 循环开始，再按需开启任务系统、sub-agent、async teams、定时任务、记忆、上下文压缩、多模型协议适配和知识库等能力。

## 整体交互演示

![LLM Space 整体操作演示](images/llm-space.gif)

## 先用最小 Harness 跑一次

最快理解这个项目的方式，是先用最小对话 Harness 跑一次，再逐步打开高级特性。

1. 安装并启动：

   ```bash
   npm install
   npm run dev
   ```

2. 打开前端：

   ```text
   http://localhost:5174
   ```

3. 在左侧配置区添加或选择一个模型。

   你可以直接通过 UI 添加模型，也可以按 [模型配置](#模型配置) 中的结构编辑 `.env`。

4. 在 **Harness Explorer** 中选择：

   ```text
   01-chat-bot.json
   ```

5. 先发一条普通对话：

   ```text
   你好，介绍一下你自己
   ```

6. 再试一次工具调用：

   ```text
   查询北京天气
   ```

7. 打开 **Context Inspector**，查看实际发送给模型的 system prompt、messages payload 和 provider tool schema。

完成这次最小体验后，再切换到 Prompt Lab 或其他 Harness，逐个启用高级特性。

## 你可以实验什么

- **白盒运行轨迹**：查看流式回答、thinking block、工具调用、工具结果、最终回答和 child-agent 事件。
- **Prompt 与 Payload 检查**：Context Inspector 展示实际发送给模型的 system prompt sections、messages payload transcript 和 provider tool schema。
- **可编辑指导层**：基础 agent 指导词使用文件化 `AGENTS.md` 承载，不再只是隐藏在 JSON 里的 prompt 字段。
- **多供应商模型网关**：模型配置支持 provider-neutral 调用，通过 Anthropic Messages、OpenAI-compatible Chat Completions 等协议适配器接入不同 provider。
- **任务编排实验**：比较 inline execution、TODO planning、DAG task-system、sub-agent delegation、async teammate coordination 等模式。
- **定时任务 MVP**：让 Agent 创建、查看、取消并执行当前 Harness 作用域内的计划任务。
- **自动记忆质量门**：自动提取记忆会被路由为 `auto_write`、`pending_review`、`discard`、`sensitive_blocked`。
- **安全与可靠性控制**：敏感文件访问、路径穿越、高风险 bash、child-agent 权限事件、大输出处理等都按 fail-closed 思路防御。

## 最近亮点

- **Knowledge Base / RAG pipeline**：文档 loader、embedding provider、Local JSON / Qdrant 向量存储、Qwen3 rerank 和 retrieval evaluation records。
- **MCP Studio**：配置 STDIO 和 Streamable HTTP MCP server，连接 Context7，将发现的工具挂载到当前 harness，并检查 MCP 工具调用。
- **多供应商模型网关**：模型调用通过 Anthropic Messages 和 OpenAI-compatible Chat Completions 协议适配器。
- **任务编排实验**：比较 TODO planning、DAG task-system、sub-agent delegation 和 async teammate coordination。
- **定时任务调度器**：Harness 作用域的计划任务复用同一条 AgentExecutor 路径，并保留执行历史。

详细历史见：[更新日志](./docs/changelog.zh-CN.md)。

## MCP Servers

进入 **MCP** 标签页，可以把外部 MCP server 配置成运行时工具。

当前 MVP 支持：

- 本地 STDIO MCP server，包括你自己写的脚本。
- Streamable HTTP MCP server。
- 内置 Context7 预设：`npx -y @upstash/context7-mcp`。
- 通用本地 Environment 与 HTTP Headers 编辑器，可配置 API Key、Token 和任意 provider 字段。
- Harness 级挂载，不同 harness 可以暴露不同 MCP 工具集。

自写 MCP、Context7、Streamable HTTP 的详细测试步骤见：[MCP 配置指南](./docs/mcp-setup.zh-CN.md)。

## 快速开始

环境要求：

- Node.js 18 或更高版本
- npm
- Docker Desktop（可选；测试 Qdrant 向量数据库时需要）

安装并启动：

```bash
npm install
npm run dev
```

启动后：

- 后端：`http://localhost:3001`
- 前端：`http://localhost:5174`

验证命令：

```bash
npm test
npm run build
```

如果要测试向量检索，先启动本地 Qdrant：

```bash
docker compose --env-file docker/qdrant.env up -d qdrant
curl http://localhost:6333/collections
```

这里使用专用 `docker/qdrant.env`，避免 Docker Compose 误读应用 `.env` 中的多行 `MODELS_CONFIG`。

Qdrant Dashboard：

```text
http://localhost:6333/dashboard
```

## 模型配置

可以从 `.env.example` 创建 `.env`，也可以直接通过 UI 添加模型。

典型 `.env` 内容：

```dotenv
PORT=3001
TAVILY_API_KEY=tvly-your-key-here
ZHIPU_API_KEY=your-zhipu-key-here
DASHSCOPE_API_KEY=your-dashscope-key-here
QDRANT_API_KEY=
MODELS_CONFIG=[]
```

模型配置以结构化 JSON 管理。每个模型可以独立选择协议和连接方式：

- `protocol: "anthropic"`：Anthropic-compatible Messages API。
- `protocol: "openai_chat_completions"`：OpenAI-compatible Chat Completions API。
- `baseUrl`、API key、model id、context window、provider-specific `extraBody` 都属于模型配置层。

Agent Loop 不应关心 provider 名称。协议适配器负责标准化 request、streaming event、tool call、thinking/reasoning content、usage 和 prompt-cache 字段。

## 核心架构

### Harness

Harness 是一个本地 Agent 配置，负责控制工具挂载、实验特性、模型选择、可编辑指导词和任务编排策略。

Harness 文件位于：

```text
harnesses/
```

可编辑基础指导词位于：

```text
guidance/<harnessId>/AGENTS.md
```

### Agent Loop

运行时采用 hook-oriented loop：

1. 用户输入处理
2. Pre-LLM 状态组装
3. 模型网关调用
4. 工具执行前权限与安全检查
5. 工具调度
6. 工具后处理与 offload
7. 停止、持久化与 UI 广播

新的运行时能力应优先做成可拆卸模块或插件，不要把临时分支继续堆进主 executor。

### Context Assembly

Prompt 组装会被记录为显式 section。当前 Context Inspector 默认只展示真正发送给模型的内容：

- System Prompt sections
- Messages Payload transcript
- Provider Tool Schema

Runtime queues、memory candidates、tool-pool summaries 等 sidecar 状态，只有在真正注入模型请求时才进入默认视图；否则应该放在独立可观察面板里。

### 记忆分层

LLM Space 将长期上下文拆成三层：

- **Explicit Guidance**：用户明确要求长期遵守的规则和项目指导，使用 `AGENTS.md` 承载。
- **Auto-Capture Working Layer**：不确定、待观察、可能过期的候选记忆。
- **Curated Long-term Memory**：通过质量与安全检查的稳定跨会话事实。

这样既保留自动记忆的可观察性，又不会把每次记忆提取都变成打断式审批。

## 内置 Harness 预设

| Harness | 用途 |
| --- | --- |
| `01-chat-bot.json` | 最小 ReAct 对话与简单工具。 |
| `02-bash.json` | 文件系统、shell、网络搜索实验。 |
| `03-deep-research.json` | TODO 驱动的研究与规划。 |
| `04-subagent.json` | Sub-agent 委托与上下文隔离。 |
| `05-task-system.json` | DAG 任务拆解与 claim/complete 流程。 |

这些预设只是示例，不是固定产品。你可以通过 Prompt Lab 和配置面板组合自己的 Harness 行为。

## 实验系统

### 任务编排

LLM Space 保持编排原语可拆卸：

- `write_todos`：轻量 planning。
- DAG `task-system`：带依赖的任务系统。
- `sub_agent`：一次性隔离委托。
- async teams：有限异步 teammate 协作。
- strategy presets：组合上述原语，但不把它们黑盒封装。

简单任务应保持简单。如果用户明确要求某种执行方式，例如“调用 sub-agent”，Harness 应尊重该方式，除非先向用户确认替代方案。

### 定时任务

Cron Scheduler 暴露：

- `schedule_cron`
- `list_crons`
- `cancel_cron`

任务按 Harness 作用域隔离，并复用同一条 AgentExecutor 路径执行。如果目标 Harness 忙碌，定时事件会排队，避免同一个 session 上并发启动多个 agent loop。

### 知识库

Task 15 已加入本地 RAG 知识库 MVP；Task 16 已加入文档 loader、真实 embedding provider、Local JSON / Qdrant 向量存储、keyword / vector / hybrid 检索策略、可选的 Qwen3 rerank 重排，以及 retrieval evaluation records。

用户可以创建本地知识库，导入 Markdown/text/JSON/CSV/PDF/DOCX 文件，生成有边界的 chunks 和索引，预览检索结果，并把选中的知识库挂载到对话中。知识应该像可挂载运行时资源一样工作，而不是硬编码进 prompt。

完整配置教程见：[知识库 / RAG 配置指南](./docs/knowledge-base-setup.zh-CN.md)。

当前形态：

- 本地知识库 metadata 与存储
- 有边界的 ingestion 与 chunking
- 带来源标签的检索预览
- Harness 级挂载
- Auto RAG：每轮自动从已挂载知识库检索
- Agentic RAG：稳定挂载清单 + `list_mounted_knowledge_bases` / `query_knowledge_base` 工具
- Manual Lab：只在 Knowledge 页面测试检索，不改变对话上下文
- Recent Retrieval Records：有边界地记录 initial recall、rerank、final results、top scores 和 sources，用于对比检索质量，但不落盘 chunk 正文
- Context Inspector 分层展示 Mounted Knowledge Manifest、Retrieved Knowledge、Messages Payload 和 Provider Tool Schema

推荐快速模式：

```text
轻量本地：
  Retrieval strategy: Keyword
  Index method: Keyword
  Embedding provider: None
  Vector store: Local JSON
  Rerank provider: None

本地向量：
  Retrieval strategy: Vector 或 Hybrid
  Index method: Vector 或 Hybrid
  Embedding provider: Zhipu embedding-3
  Vector store: Local JSON
  Rerank provider: None

完整链路：
  Retrieval strategy: Hybrid
  Index method: Hybrid
  Embedding provider: Zhipu embedding-3
  Vector store: Qdrant
  Rerank provider: Qwen3 Rerank
```

常用环境变量：

```text
ZHIPU_API_KEY=...
DASHSCOPE_API_KEY=...
QDRANT_API_KEY=...
```

详细指南包含 provider URL、字段含义、Qdrant 配置、rerank 配置、测试流程和常见问题排查。

## 开发工作流

常用命令：

```bash
npm run dev
npm test
npm run build
npm run lint
```

新增工具时，在 `server/tools/` 下创建模块，并在 `server/tools/index.js` 注册。

示例：

```js
export default {
  name: 'hello_tool',
  description: 'Return a greeting.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
    },
    required: ['name'],
  },
  async execute({ name }) {
    return `Hello, ${name}.`;
  },
};
```

## 关键文档

- [开发规范](./docs/DEVELOPMENT_SPEC.md)
- [Development Spec, English](./docs/DEVELOPMENT_SPEC.en.md)
- [知识库 / RAG 配置指南](./docs/knowledge-base-setup.zh-CN.md)
- [Knowledge Base / RAG Setup Guide](./docs/knowledge-base-setup.md)
- [更新日志](./docs/changelog.zh-CN.md)
- [Changelog](./docs/changelog.md)
- [Runtime Roadmap 汇总计划](./docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md)

## 设计原则

- 优先可观察行为，不做黑盒自动化。
- 优先可拆卸原语，不做封闭商业 Agent 模式。
- 模型 provider 逻辑留在 gateway，不进入 agent loop。
- Prompt 组装要 cache-friendly：稳定内容在前，动态内容靠后。
- 文件系统、shell、凭据相关能力必须 fail-closed。
- Context Inspector 专注展示真实模型 payload。

## 参与贡献

这是一个本地实验工作台。欢迎改进可观察性、安全性、运行时模块化、prompt assembly、模型适配、任务编排和知识库挂载。
