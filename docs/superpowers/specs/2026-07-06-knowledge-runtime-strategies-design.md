# Knowledge Runtime Strategies Design

## Purpose

Knowledge should become a first-class experiment surface, at the same level as Prompt Lab and Trajectory. It must let users create, mount, inspect, retrieve from, and runtime-test knowledge bases with white-box visibility into what enters the model request.

The feature must preserve LLM-Space's core principles:

- Knowledge bases are mountable resources, not hidden prompt text.
- Stable mount metadata and dynamic retrieval results are separate context layers.
- Users can compare different RAG runtime strategies on the same harness.
- Context Inspector must show exactly what the current model call receives.

## Current State

The current MVP supports:

- Creating local keyword-index knowledge bases under `.knowledge`.
- Adding `.md`, `.txt`, and `.json` files.
- Mounting knowledge bases per harness.
- Manually testing retrieval in the Knowledge page.
- Injecting a `<mounted_knowledge>` block into the latest user message.
- Displaying injected knowledge as a prompt assembly section.

The current implementation is intentionally small, but it has one architectural issue: mounted knowledge manifest and retrieved chunks share one dynamic block. That makes stable mount metadata repeat every turn and makes prompt-cache behavior harder to reason about.

## Runtime Strategies

Knowledge runtime behavior is controlled by one strategy selected per harness.

### 1. Auto RAG

Auto RAG simulates a Dify-style knowledge application.

Behavior:

- Mounted Knowledge Manifest is pinned as stable context.
- Each user turn automatically retrieves from mounted knowledge bases.
- Retrieved chunks are injected into the latest user message only when at least one chunk matches.
- Knowledge tools may remain hidden by default.

Use this when the harness is primarily a knowledge Q&A app.

### 2. Agentic RAG

Agentic RAG lets the agent decide when to retrieve.

Behavior:

- Mounted Knowledge Manifest is pinned as stable context.
- Automatic retrieval is disabled.
- Knowledge tools are exposed:
  - `list_mounted_knowledge_bases`
  - `query_knowledge_base`
- The agent can answer "what knowledge bases are mounted" from manifest or by calling the list tool.
- The agent can call query when the task needs source material.

Use this for general-purpose agents that sometimes need knowledge.

### 3. Manual Lab

Manual Lab keeps knowledge experiments out of the conversation runtime.

Behavior:

- Knowledge bases can be mounted for lab visibility.
- Automatic retrieval is disabled.
- Knowledge tools are disabled.
- Retrieval is tested only inside the Knowledge page.
- Manifest injection is disabled for the model request.

Use this when tuning chunking, indexing, scores, and retrieval behavior without affecting chat.

## Prompt Assembly Layers

### Mounted Knowledge Manifest

The manifest is stable mount metadata. It changes only when harness mount state changes or knowledge base metadata changes.

Shape:

```xml
<mounted_knowledge_manifest>
  <knowledge_base id="kb_docs" name="Project Docs" files="2" chunks="13">
    Stable description for the mounted knowledge base.
  </knowledge_base>
</mounted_knowledge_manifest>
```

Placement:

- Target: `system`
- Lifecycle: `pinned`
- Source: `knowledge/mounts`
- Cache impact: `changes_on_mount`

The manifest is injected for Auto RAG and Agentic RAG. It is not injected for Manual Lab.

### Retrieved Knowledge

Retrieved Knowledge is dynamic query-specific context.

Shape:

```xml
<retrieved_knowledge>
  <source index="1" id="chunk_1" knowledge_base="Project Docs" filename="README.md" chunk_index="0" score="2.5000">
    Retrieved chunk text.
  </source>
</retrieved_knowledge>
```

Placement:

- Target: latest user message
- Lifecycle: `dynamic`
- Source: `knowledge/retrieval`
- Cache impact: `changes_per_user_turn`

Rules:

- Inject only when retrieved chunk count is greater than zero.
- Do not inject an empty retrieval block.
- Do not keep old retrieved blocks in future API messages.
- Retrieved chunk count and total characters must be bounded by strategy settings.

## Knowledge Tools

Two tools are added for Agentic RAG:

### `list_mounted_knowledge_bases`

Parameters: none.

Returns a compact list of mounted bases:

```text
Mounted knowledge bases for harness 00-full-test:
- kb_docs: Project Docs (2 files, 13 chunks) - Product and design notes
```

### `query_knowledge_base`

Parameters:

- `query`: required string.
- `knowledgeBaseIds`: optional array of strings. When omitted, query all mounted bases.
- `topK`: optional number.
- `maxChars`: optional number.
- `scoreThreshold`: optional number.

Returns source-labeled chunks in a bounded text format. It must not return raw full files.

## Feature Schema

Knowledge runtime settings live under a `knowledge_bases` feature group.

Initial shape:

```json
{
  "knowledge_bases": {
    "enabled": true,
    "strategy": "agentic_rag",
    "auto_retrieve": false,
    "knowledge_tools": true,
    "topK": 5,
    "maxChars": 8000,
    "scoreThreshold": 0
  }
}
```

Preset mapping:

| Strategy | Manifest | Auto Retrieve | Knowledge Tools |
| --- | --- | --- | --- |
| `auto_rag` | on | on | off |
| `agentic_rag` | on | off | on |
| `manual_lab` | off | off | off |

Manual primitive edits move the strategy to `custom`, matching the task orchestration strategy pattern.

## Knowledge Page UX

Knowledge becomes a multi-section experiment surface:

- Library: all knowledge bases.
- Detail: metadata, files, chunk settings, add file, delete base.
- Mounting: current harness mounted bases and runtime strategy.
- Retrieval Lab: query, topK, threshold, results, prompt preview.

The main Trajectory config panel remains lightweight:

- Shows mounted bases for the current harness.
- Allows quick mount/unmount.
- Links to the full Knowledge page.

## Context Inspector

Context Inspector displays model-bound knowledge in separate groups:

- System Prompt
- Mounted Knowledge Manifest
- Retrieved Knowledge
- Messages Payload
- Provider Tool Schema

Manifest and retrieved chunks are also present in the final payload where they are actually sent. The separate groups are navigational views over prompt assembly sections, not separate hidden state.

## Non-Goals

This phase does not add:

- Vector embeddings.
- Reranking models.
- PDF or Office parsing.
- Citation popovers in final chat messages.
- Multi-tenant permission models.

Those belong to later RAG stages after the runtime strategy layer is stable.

## Success Criteria

1. Users can choose `Auto RAG`, `Agentic RAG`, or `Manual Lab` per harness.
2. Auto RAG automatically injects retrieved chunks only when retrieval matches.
3. Agentic RAG exposes knowledge tools and does not auto-retrieve.
4. Manual Lab does not inject knowledge into conversation runtime.
5. Mounted Knowledge Manifest is stable context and does not repeat inside every user message.
6. Context Inspector clearly separates manifest and retrieved chunks.
7. Tests cover strategy preset behavior, plugin injection, tool behavior, dry-run inspector output, and UI model helpers.

