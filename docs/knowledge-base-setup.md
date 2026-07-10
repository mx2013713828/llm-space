# Knowledge Base / RAG Setup Guide

This guide explains how to configure LLM Space Knowledge Bases for keyword search, vector retrieval, Qdrant storage, and optional rerank.

The Knowledge feature is intentionally white-box and modular. You can use a small local keyword setup, a local vector setup, or a full retrieval pipeline with embedding, Qdrant, and Qwen rerank.

## Pipeline Overview

```text
Create Knowledge Base
  -> configure recall and indexing
  -> configure embedding provider
  -> configure vector store
  -> configure optional rerank
  -> Index files
  -> run Retrieval Test
  -> mount the base into a harness
```

At runtime, retrieval follows this shape:

```text
User query
  -> Recall: keyword / vector / hybrid
  -> Optional rerank
  -> Apply topK, maxChars, scoreThreshold
  -> Inject or expose retrieved chunks
```

## Quick Modes

### Mode 1: Lightweight Local

Use this when you only want a fast local smoke test.

```text
Retrieval strategy: Keyword
Index method: Keyword
Embedding provider: None
Vector store: Local JSON
Rerank provider: None
```

No external API key is required.

### Mode 2: Local Vector

Use this to test embeddings without running Qdrant.

```text
Retrieval strategy: Vector or Hybrid
Index method: Vector or Hybrid
Embedding provider: Zhipu embedding-3
Embedding model: embedding-3
Dimensions: 1024
Embedding URL: https://open.bigmodel.cn/api/paas/v4/embeddings
API key env: ZHIPU_API_KEY
Vector store: Local JSON
Rerank provider: None
```

Vectors are saved in the local knowledge base `vector-index.json`.

### Mode 3: Full Pipeline

Use this to test the current full pipeline.

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

Rerank provider: Qwen3 Rerank
Rerank model: qwen3-rerank
Rerank URL: https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks
Rerank key env: DASHSCOPE_API_KEY
Rerank top N: 5
```

Replace `{WorkspaceId}` with your Alibaba Cloud Model Studio workspace id.

## Environment Variables

Create `.env` from `.env.example`, then add the keys you need:

```dotenv
ZHIPU_API_KEY=your-zhipu-api-key
DASHSCOPE_API_KEY=your-dashscope-api-key
QDRANT_API_KEY=
```

Important: the UI stores environment variable names, not raw secrets.

For example, in the Knowledge page:

```text
Embedding API key env: ZHIPU_API_KEY
Rerank API key env: DASHSCOPE_API_KEY
Qdrant key env: QDRANT_API_KEY
```

After editing `.env`, restart the backend:

```bash
npm run dev
```

## Qdrant Setup

Local Qdrant requires Docker Desktop.

Start Qdrant:

```bash
docker compose --env-file docker/qdrant.env up -d qdrant
```

Verify:

```bash
curl http://localhost:6333/collections
```

Dashboard:

```text
http://localhost:6333/dashboard
```

The project uses `docker/qdrant.env` so Docker Compose does not parse the app `.env`, which can contain multiline `MODELS_CONFIG`.

## Configuration Sections

### Recall

Recall controls how candidates are retrieved before rerank.

| UI Label | Field | Meaning |
| --- | --- | --- |
| Retrieval strategy | `retrievalStrategy` | Query-time retrieval method: `keyword`, `vector`, or `hybrid`. |
| Index method | `indexMethod` | Index-time method: `keyword`, `vector`, or `hybrid`. |
| Top K | `topK` | Number of candidate chunks retrieved before rerank. |
| Max chars | `maxChars` | Character budget for returned or injected chunks. |
| Score threshold | `scoreThreshold` | Minimum score gate. Low-confidence chunks can be skipped from model injection. |

Recommended starting values:

```text
topK: 5-20
maxChars: 8000
scoreThreshold: 0 for general testing, 0.45+ for unrelated-query testing
```

### Embedding

Embedding converts text chunks and queries into vectors. It is required for `vector` and `hybrid` retrieval.

| UI Label | Field | Meaning |
| --- | --- | --- |
| Provider | `embeddingProvider` | `none`, `zhipu_embedding_3`, or `openai_compatible`. |
| Model | `embeddingModel` | Model id sent to the embedding API. |
| Dimensions | `embeddingDimensions` | Vector dimensions. Must match the provider/model output. |
| Embedding URL | `embeddingBaseUrl` | Embedding API endpoint. |
| API key env | `embeddingApiKeyEnv` | Environment variable name containing the API key. |

Currently supported embedding providers:

| Provider | Model | URL | Dimensions |
| --- | --- | --- | --- |
| `zhipu_embedding_3` | `embedding-3` | `https://open.bigmodel.cn/api/paas/v4/embeddings` | `1024` |
| `openai_compatible` | provider-specific | provider-specific `/embeddings` URL | provider-specific |

Use `Test Embedding` before indexing.

### Vector Store

Vector Store controls where vectors are persisted.

| UI Label | Field | Meaning |
| --- | --- | --- |
| Store | `vectorStore` | `local_json` or `qdrant`. |
| Qdrant URL | `qdrantUrl` | Qdrant API endpoint. |
| Collection | `qdrantCollection` | Qdrant collection name. Empty means auto per KB. |
| API key env | `qdrantApiKeyEnv` | Optional env var for Qdrant Cloud. Local Docker usually leaves this empty. |

Notes:

- `local_json` is easiest for local development.
- `qdrant` is better for testing a realistic vector database path.
- Re-index files after changing vector store or embedding settings.

### Rerank

Rerank is an optional second pass over retrieved chunks.

| UI Label | Field | Meaning |
| --- | --- | --- |
| Provider | `rerankProvider` | `none` or `qwen3_rerank`. |
| Model | `rerankModel` | Rerank model id. Current default: `qwen3-rerank`. |
| Top N | `rerankTopN` | Number of chunks kept after rerank. Usually <= `topK`. |
| Rerank URL | `rerankBaseUrl` | Rerank API endpoint. |
| API key env | `rerankApiKeyEnv` | Environment variable name containing the rerank API key. |
| Instruct | `rerankInstruct` | Task instruction sent to the rerank model. |

Currently supported rerank provider:

| Provider | Model | URL |
| --- | --- | --- |
| `qwen3_rerank` | `qwen3-rerank` | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks` |

Use `Test Rerank` before running retrieval.

## File Types

Currently supported:

- Markdown: `.md`, `.markdown`
- Text: `.txt`
- JSON: `.json`
- CSV: `.csv`
- PDF: `.pdf`
- Word: `.docx`

PDF and DOCX use lightweight text extraction. Layout-aware parsing, table reconstruction, OCR, and multimodal parsing are future work.

## Runtime Strategies

Knowledge mounting supports three runtime strategies:

| Strategy | Meaning |
| --- | --- |
| Auto RAG | Automatically retrieves from mounted bases on each user turn. |
| Agentic RAG | Pins the mounted manifest and exposes knowledge tools so the agent can decide when to query. |
| Manual Lab | Keeps retrieval experiments inside the Knowledge page only. |

Context Inspector separates:

- Mounted Knowledge Manifest: stable mounted base list.
- Retrieved Knowledge: per-turn retrieved chunks.
- Messages Payload: final model messages.
- Provider Tool Schema: tools exposed to the model.

## Recommended Test Flow

1. Configure `.env`.
2. Restart `npm run dev`.
3. If using Qdrant, start Docker and Qdrant.
4. Open Knowledge page.
5. Create or select a Knowledge Base.
6. Fill Retrieval Quality settings.
7. Click `Test Embedding`.
8. Click `Test Rerank` if rerank is enabled.
9. Click `Save Retrieval Settings`.
10. Select files and click `Index`.
11. Run `Retrieval Test`.
12. Mount the base and test it in chat.
13. Open Context Inspector to confirm what was sent.

## Troubleshooting

### `fetch failed` during Index

Most likely causes:

- Qdrant is selected but not running.
- Embedding URL is unreachable.
- Network/proxy issue.

Check Qdrant:

```bash
curl http://localhost:6333/collections
```

If you do not need Qdrant, switch Vector Store to `Local JSON`.

### Qdrant collection already exists

This is expected when re-indexing the same collection. Current code treats Qdrant `409` as idempotent and continues to upsert points.

If you still see this error, restart the dev server and confirm your branch includes the Qdrant idempotency fix.

### Rerank 401 / invalid API key

Check:

- `.env` contains the correct `DASHSCOPE_API_KEY`.
- UI field is `DASHSCOPE_API_KEY`, not the raw key.
- The backend was restarted after editing `.env`.
- The key belongs to the same Alibaba Cloud Model Studio workspace.
- The key has no missing characters.

### Embedding 401 / invalid API key

Check:

- `.env` contains `ZHIPU_API_KEY`.
- UI field is `ZHIPU_API_KEY`.
- Backend was restarted after editing `.env`.

### Unrelated queries still retrieve chunks

Vector search always returns nearest neighbors unless gated. Raise:

```text
Score threshold: 0.45 or higher
```

Then inspect Context Inspector. Skipped retrieved knowledge should be observable but not injected into the model.

### Changed settings but results did not change

After changing `embeddingProvider`, `embeddingModel`, `embeddingDimensions`, `vectorStore`, or `qdrantCollection`, re-index files. Existing indexed files are not automatically re-vectorized.

