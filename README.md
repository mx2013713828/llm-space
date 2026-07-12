[English](./README.md) | [简体中文](./README.zh-CN.md)

# LLM Space

[![Node Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-flat.svg?style=flat-square&color=339966)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-flat.svg?style=flat-square&color=blue)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-node%20--test-blue.svg?style=flat-square)](./package.json)

> A zero-abstraction white-box debugger for building and testing AI agents like composable LEGO blocks.

LLM Space is a visual AI Agent harness workbench for developers. It is intentionally not a heavy agent framework. Instead, it exposes the runtime loop, prompt assembly, model payload, tool calls, memory, task orchestration, retrieval, and child-agent behavior so you can see and change how an agent is put together.

Many agent frameworks hide behavior behind layers of abstractions. LLM Space takes the opposite path: what the agent sees, thinks, calls, retrieves, and sends to the provider should be inspectable and swappable.

The product principle is simple: keep the platform experimental, observable, and detachable. Start with a minimal ReAct loop, then selectively enable task systems, sub-agents, async teams, scheduled jobs, memory, compaction, provider adapters, and knowledge bases.

## Demo

![LLM Space overall interaction demo](images/llm-space.gif)

## Try The Smallest Harness First

The fastest way to feel the project is to run the minimal chat harness before exploring advanced systems.

1. Install and start the app:

   ```bash
   npm install
   npm run dev
   ```

2. Open the frontend:

   ```text
   http://localhost:5174
   ```

3. Add or select a model in the left configuration panel.

   You can add a model through the UI, or edit `.env` using the structure shown in [Model Configuration](#model-configuration).

4. In **Harness Explorer**, select:

   ```text
   01-chat-bot.json
   ```

5. Send a simple message:

   ```text
   你好，介绍一下你自己
   ```

6. Try the first tool call:

   ```text
   What is the weather in Beijing?
   ```

7. Open **Context Inspector** to see the actual prompt, messages payload, and provider tool schema sent to the model.

After this first run, switch to Prompt Lab or another harness to enable advanced features one by one.

## What You Can Explore

- **White-box agent trajectories**: inspect streamed assistant text, thinking blocks, tool calls, tool results, final answers, and child-agent events.
- **Prompt and payload inspection**: Context Inspector shows the actual system prompt sections, messages payload transcript, and provider tool schema sent to the model.
- **Editable guidance**: base agent instructions are stored as file-backed `AGENTS.md` guidance rather than hidden JSON-only prompt text.
- **Multi-provider model gateway**: model configuration supports provider-neutral runtime calls with protocol adapters such as Anthropic Messages and OpenAI-compatible Chat Completions.
- **Task orchestration experiments**: compare inline execution, TODO planning, DAG task-system planning, sub-agent delegation, and async teammate coordination.
- **Cron scheduler MVP**: let an agent create, list, cancel, and run harness-scoped scheduled jobs.
- **Memory quality gate**: automatic memory extraction is filtered through `auto_write`, `pending_review`, `discard`, and `sensitive_blocked` decisions.
- **Security and reliability controls**: sensitive file access, path traversal, high-risk bash operations, child-agent permission events, and large-output behavior are handled defensively.

## Recent Highlights

- **Knowledge Base / RAG pipeline**: document loaders, embedding providers, Local JSON / Qdrant vector stores, Qwen3 rerank, and retrieval evaluation records.
- **MCP Studio**: configure STDIO and Streamable HTTP MCP servers, connect Context7, mount discovered tools into a harness, inspect lifecycle/authentication evidence, and review bounded MCP call records.
- **Multi-provider gateway**: model calls go through protocol adapters for Anthropic Messages and OpenAI-compatible Chat Completions.
- **Task orchestration**: compare TODO planning, DAG task-system planning, sub-agent delegation, and async teammate coordination.
- **Cron scheduler**: harness-scoped scheduled jobs reuse the same AgentExecutor path and keep execution history.

Detailed history lives in [Changelog](./docs/changelog.md).

## MCP Servers

Open the **MCP** tab to configure external MCP servers as runtime tools.

The first MVP supports:

- Local STDIO MCP servers, including your own scripts.
- Streamable HTTP MCP servers.
- A built-in Context7 preset using `npx -y @upstash/context7-mcp`.
- Generic local Environment and HTTP Header editors for API keys, tokens, and custom provider fields.
- Harness-level mounting, so each harness can expose a different MCP tool set.
- Harness/server/tool approval inheritance: `tool > server > harness`, with fail-closed read-only defaults.
- Safe runtime diagnostics and lazy call details, without rendering raw request arguments or credentials.

See [MCP Setup Guide](./docs/mcp-setup.md) for custom server, Context7, and Streamable HTTP testing steps.

## Quick Start

Requirements:

- Node.js 18 or newer
- npm
- Docker Desktop (optional; required for local Qdrant vector-store testing)

Install and run:

```bash
npm install
npm run dev
```

The dev command starts:

- Backend: `http://localhost:3001`
- Frontend: `http://localhost:5174`

Run verification:

```bash
npm test
npm run build
```

To test vector retrieval, start local Qdrant first:

```bash
docker compose --env-file docker/qdrant.env up -d qdrant
curl http://localhost:6333/collections
```

The dedicated `docker/qdrant.env` file prevents Docker Compose from parsing the app `.env`, which may contain multiline `MODELS_CONFIG` JSON.

Qdrant Dashboard:

```text
http://localhost:6333/dashboard
```

## Model Configuration

Create `.env` from `.env.example`, or add models through the UI.

Typical `.env` entries:

```dotenv
PORT=3001
TAVILY_API_KEY=tvly-your-key-here
ZHIPU_API_KEY=your-zhipu-key-here
DASHSCOPE_API_KEY=your-dashscope-key-here
QDRANT_API_KEY=
MODELS_CONFIG=[]
```

Model entries are managed as structured JSON. A model can choose its protocol and provider connection independently:

- `protocol: "anthropic"` for Anthropic-compatible Messages APIs.
- `protocol: "openai_chat_completions"` for OpenAI-compatible Chat Completions APIs.
- `baseUrl`, API key, model id, context window, and provider-specific `extraBody` live in model configuration.

The agent loop should not branch on a provider name. Protocol adapters normalize requests, streaming events, tool calls, thinking/reasoning content, usage, and prompt-cache fields.

## Core Architecture

### Harnesses

A Harness is a local agent configuration. It controls the mounted tools, enabled experimental features, selected model, editable guidance, and orchestration strategy.

Harness files live under:

```text
harnesses/
```

Editable base guidance is file-backed under:

```text
guidance/<harnessId>/AGENTS.md
```

### Agent Loop

The runtime follows a hook-oriented loop:

1. user input handling
2. pre-LLM state assembly
3. model gateway call
4. pre-tool permission and security checks
5. tool dispatch
6. post-tool processing and offload
7. stop, persistence, and UI broadcast

New runtime features should be implemented as detachable modules or plugins instead of growing the main executor with ad-hoc branches.

### Context Assembly

Prompt assembly is tracked as explicit sections. The current Context Inspector defaults to model-bound content only:

- System Prompt sections
- Messages Payload transcript
- Provider Tool Schema

Sidecar state such as runtime queues, memory candidates, or debug summaries belongs in dedicated observability surfaces unless it is actually injected into the model request.

### Memory Layers

LLM Space separates long-term context into three layers:

- **Explicit Guidance**: manually editable rules and project instructions, backed by `AGENTS.md`.
- **Auto-Capture Working Layer**: uncertain or provisional memory candidates.
- **Curated Long-term Memory**: stable cross-session facts that pass quality and safety checks.

This keeps automatic memory observable without turning every extraction into a blocking approval workflow.

## Built-in Harness Presets

| Harness | Purpose |
| --- | --- |
| `01-chat-bot.json` | Minimal ReAct-style chat and simple tools. |
| `02-bash.json` | Filesystem, shell, and web-search experiments. |
| `03-deep-research.json` | TODO-driven research and planning. |
| `04-subagent.json` | Sub-agent delegation and context isolation. |
| `05-task-system.json` | DAG task decomposition with claim/complete flow. |

Presets are examples, not fixed products. Use Prompt Lab and configuration panels to compose your own harness behavior.

## Experimental Systems

### Task Orchestration

LLM Space keeps orchestration primitives detachable:

- `write_todos` for lightweight planning.
- DAG `task-system` tools for dependency-aware work.
- `sub_agent` for isolated one-off delegation.
- async teams for finite teammate coordination.
- strategy presets for combining these primitives without hiding them.

Simple tasks should stay simple. If a user explicitly asks for a specific execution route, such as using a sub-agent, the harness should respect that route unless it first confirms a better alternative.

### Scheduled Jobs

Cron Scheduler exposes:

- `schedule_cron`
- `list_crons`
- `cancel_cron`

Jobs are scoped to a harness and run through the same agent executor path. If the target harness is busy, scheduled events are queued instead of launching concurrent loops against the same session.

### Knowledge Bases

Task 15 adds a local RAG Knowledge Base MVP. Task 16 adds document loaders, real embedding providers, Local JSON / Qdrant vector stores, keyword / vector / hybrid retrieval strategies, optional Qwen3 rerank, and retrieval evaluation records.

Users can create local knowledge bases, import Markdown/text/JSON/CSV/PDF/DOCX files, generate bounded chunks and indexes, preview retrieval, and mount selected knowledge into a conversation. Knowledge behaves like a mounted runtime resource, not hard-coded prompt text.

See the full setup guide: [Knowledge Base / RAG Setup Guide](./docs/knowledge-base-setup.md).

Current shape:

- local knowledge store and metadata
- bounded ingestion and chunking
- retrieval preview with source labels
- harness-level mounting
- Auto RAG: automatic retrieval from mounted bases on each user turn
- Agentic RAG: pinned mounted manifest plus `list_mounted_knowledge_bases` / `query_knowledge_base` tools
- Manual Lab: retrieval testing in the Knowledge page without changing chat context
- Recent Retrieval Records: bounded comparison records for initial recall, rerank, final results, top scores, and sources without persisting chunk text
- Context Inspector separates Mounted Knowledge Manifest, Retrieved Knowledge, Messages Payload, and Provider Tool Schema

Recommended quick modes:

```text
Lightweight local:
  Retrieval strategy: Keyword
  Index method: Keyword
  Embedding provider: None
  Vector store: Local JSON
  Rerank provider: None

Local vector:
  Retrieval strategy: Vector or Hybrid
  Index method: Vector or Hybrid
  Embedding provider: Zhipu embedding-3
  Vector store: Local JSON
  Rerank provider: None

Full pipeline:
  Retrieval strategy: Hybrid
  Index method: Hybrid
  Embedding provider: Zhipu embedding-3
  Vector store: Qdrant
  Rerank provider: Qwen3 Rerank
```

Common environment variables:

```text
ZHIPU_API_KEY=...
DASHSCOPE_API_KEY=...
QDRANT_API_KEY=...
```

The detailed guide covers provider URLs, field meanings, Qdrant setup, rerank setup, test flow, and troubleshooting.

## Developer Workflow

Common commands:

```bash
npm run dev
npm test
npm run build
npm run lint
```

Add a new tool by creating a module in `server/tools/` and registering it in `server/tools/index.js`.

Example:

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

## Key Documents

- [Development Spec](./docs/DEVELOPMENT_SPEC.md)
- [Development Spec, English](./docs/DEVELOPMENT_SPEC.en.md)
- [Knowledge Base / RAG Setup Guide](./docs/knowledge-base-setup.md)
- [知识库 / RAG 配置指南](./docs/knowledge-base-setup.zh-CN.md)
- [Changelog](./docs/changelog.md)
- [更新日志](./docs/changelog.zh-CN.md)
- [Consolidated Runtime Roadmap](./docs/superpowers/plans/2026-06-30-runtime-roadmap-consolidated.md)

## Design Principles

- Prefer observable behavior over black-box automation.
- Prefer detachable primitives over sealed commercial-agent-style modes.
- Keep model-provider logic inside the gateway, not the agent loop.
- Keep prompt assembly cache-friendly: stable content first, dynamic content late.
- Treat filesystem, shell, and credentials as fail-closed surfaces.
- Keep Context Inspector focused on actual model payload.

## Contributing

This project is a local experimental workbench. Contributions that improve observability, safety, runtime modularity, prompt assembly, model adapters, task orchestration, or knowledge mounting are especially welcome.

## Community

[LINUX DO](https://linux.do/)