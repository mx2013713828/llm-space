[English](./README.md) | [简体中文](./README.zh-CN.md)

# LLM Space

[![Node Version](https://img.shields.io/badge/node-%3E%3D%2018.0.0-flat.svg?style=flat-square&color=339966)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-flat.svg?style=flat-square&color=blue)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-node%20--test-blue.svg?style=flat-square)](./package.json)

LLM Space is a visual, white-box workbench for experimenting with AI agent harnesses.

It is intentionally not a heavy agent framework. Instead, it exposes the runtime loop, prompt assembly, model payload, tool calls, memory, task orchestration, and child-agent behavior so you can see and change how an agent is put together.

The product principle is simple: keep the platform experimental, observable, and detachable. Users should be able to start with a minimal ReAct loop, then selectively enable features such as task systems, sub-agents, async teams, scheduled jobs, memory, compaction, and provider adapters.

## What You Can Explore

- **White-box agent trajectories**: inspect streamed assistant text, thinking blocks, tool calls, tool results, final answers, and child-agent events.
- **Prompt and payload inspection**: Context Inspector shows the actual system prompt sections, messages payload transcript, and provider tool schema sent to the model.
- **Editable guidance**: base agent instructions are stored as file-backed `AGENTS.md` guidance rather than hidden JSON-only prompt text.
- **Multi-provider model gateway**: model configuration supports provider-neutral runtime calls with protocol adapters such as Anthropic Messages and OpenAI-compatible Chat Completions.
- **Task orchestration experiments**: compare inline execution, TODO planning, DAG task-system planning, sub-agent delegation, and async teammate coordination.
- **Cron scheduler MVP**: let an agent create, list, cancel, and run harness-scoped scheduled jobs.
- **Memory quality gate**: automatic memory extraction is filtered through `auto_write`, `pending_review`, `discard`, and `sensitive_blocked` decisions.
- **Security and reliability controls**: sensitive file access, path traversal, high-risk bash operations, child-agent permission events, and large-output behavior are handled defensively.

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

Task 15 adds a local RAG Knowledge Base MVP. Task 16 adds document loaders, real embedding providers, Local JSON / Qdrant vector stores, and keyword / vector / hybrid retrieval strategies.

Users can create local knowledge bases, import Markdown/text/JSON/CSV/PDF/DOCX files, generate bounded chunks and indexes, preview retrieval, and mount selected knowledge into a conversation. Knowledge behaves like a mounted runtime resource, not hard-coded prompt text.

Current shape:

- local knowledge store and metadata
- bounded ingestion and chunking
- retrieval preview with source labels
- harness-level mounting
- Auto RAG: automatic retrieval from mounted bases on each user turn
- Agentic RAG: pinned mounted manifest plus `list_mounted_knowledge_bases` / `query_knowledge_base` tools
- Manual Lab: retrieval testing in the Knowledge page without changing chat context
- Context Inspector separates Mounted Knowledge Manifest, Retrieved Knowledge, Messages Payload, and Provider Tool Schema

Recommended real-vector test configuration:

```text
Retrieval strategy: Hybrid
Index method: Hybrid
Embedding provider: Zhipu embedding-3
Embedding model: embedding-3
Dimensions: 1024
Embedding URL: https://open.bigmodel.cn/api/paas/v4/embeddings
API key env: ZHIPU_API_KEY
Vector store: Qdrant
Qdrant URL: http://localhost:6333
Qdrant collection: leave empty for auto naming, or use rag_test
Qdrant key env: empty for local Qdrant; QDRANT_API_KEY for Qdrant Cloud
```

Test flow:

1. Set `ZHIPU_API_KEY` in `.env`, then restart `npm run dev`.
2. Run `docker compose --env-file docker/qdrant.env up -d qdrant`.
3. Create or open a Knowledge Base in the Knowledge page.
4. Fill the Retrieval Quality settings above and click `Test Embedding`.
5. Click `Save Retrieval Settings`.
6. Select files again and click `Index`. Existing files are not automatically re-vectorized after switching vector stores.
7. Compare `Keyword`, `Vector`, and `Hybrid` in Retrieval Test.

Note: with vector retrieval, Auto RAG can return the nearest chunk even for unrelated queries. For unrelated-query testing, set `Score threshold` to `0.45` or higher so low-confidence chunks are not injected into chat context.

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
