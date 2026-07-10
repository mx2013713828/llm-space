# Changelog

This file keeps detailed project history out of the README while preserving the important milestones.

## Recent Updates

### 2026-07-10: Knowledge Base / RAG Pipeline Closure

- **Mountable Knowledge Bases**: create local knowledge bases, import files, chunk and index them, preview retrieval, and mount selected bases into a harness.
- **Document loaders**: Markdown, text, JSON, CSV, PDF, and DOCX are supported through lightweight loader adapters.
- **Embedding and vector stores**: Zhipu `embedding-3`, OpenAI-compatible embedding APIs, Local JSON vector storage, and Qdrant are supported.
- **Qwen3 rerank**: optional Qwen3 Rerank through Alibaba Cloud Model Studio can reorder initially retrieved chunks.
- **Runtime strategies**: Auto RAG, Agentic RAG, and Manual Lab keep retrieval behavior configurable and observable.
- **Retrieval evaluation records**: recent retrievals show initial recall, rerank, final result counts, top scores, and source summaries without persisting chunk text.
- **Context Inspector integration**: Mounted Knowledge Manifest and Retrieved Knowledge are shown separately from system prompt, messages payload, and provider tool schema.

### 2026-06-20: In-process Cron Scheduler MVP

- **Agent-managed jobs**: `schedule_cron`, `list_crons`, and `cancel_cron` let the agent create, inspect, and cancel harness-scoped scheduled jobs.
- **Persistent execution path**: five-field cron expressions enter an in-process queue, resolve the latest model configuration at runtime, and reuse the existing `AgentExecutor`.
- **Visual scheduled trajectories**: scheduled prompts, tool calls, final answers, success/failure counts, and task status appear in the trajectory and Scheduled Tasks panel.
- **Execution history**: recent runs persist start/end time, duration, result, and errors so they remain inspectable after service restart.
- **Safe background execution**: if the target harness is busy, scheduled events queue instead of launching concurrent agent loops against the same session.

### 2026-06-13: Recoverable DAG Task System

- **Backend dependency flow**: DAG task planning supports Kahn cycle checks, claim-time exclusive file locks, and lease rollback when an agent exits unexpectedly.
- **Cache-friendly assembly**: plugin lifecycle and `preLLM` injection were refactored so static and dynamic task-state diffs are separated for better prompt-cache stability.
- **Duplicate injection protection**: XML-tagged runtime state is filtered to avoid repeated injections across turns or continuation paths.
- **Prompt Lab customization**: experimental feature cards expose editable XML guidelines with local drafts and reset-to-default behavior.

