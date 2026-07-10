# Knowledge Base / RAG 配置指南

本文介绍如何在 LLM Space 中配置 Knowledge Base，包括关键词检索、向量检索、Qdrant 向量数据库，以及可选的 rerank 重排。

Knowledge 功能保持白盒、可配置、可拆卸。你可以使用轻量本地关键词模式，也可以使用 embedding + Qdrant + Qwen rerank 的完整链路。

## 整体流程

```text
创建 Knowledge Base
  -> 配置召回与索引方式
  -> 配置 embedding provider
  -> 配置 vector store
  -> 配置可选 rerank
  -> Index 文件
  -> 运行 Retrieval Test
  -> 挂载到 Harness 对话中
```

运行时检索流程大致是：

```text
用户问题
  -> Recall：keyword / vector / hybrid 初召回
  -> 可选 rerank
  -> 应用 topK、maxChars、scoreThreshold
  -> 注入或暴露 retrieved chunks
```

## 快速模式

### 模式 1：轻量本地

适合快速验证知识库创建、文件解析和关键词检索。

```text
Retrieval strategy: Keyword
Index method: Keyword
Embedding provider: None
Vector store: Local JSON
Rerank provider: None
```

不需要外部 API key。

### 模式 2：本地向量

适合测试 embedding，但不启动 Qdrant。

```text
Retrieval strategy: Vector 或 Hybrid
Index method: Vector 或 Hybrid
Embedding provider: Zhipu embedding-3
Embedding model: embedding-3
Dimensions: 1024
Embedding URL: https://open.bigmodel.cn/api/paas/v4/embeddings
API key env: ZHIPU_API_KEY
Vector store: Local JSON
Rerank provider: None
```

向量会保存在本地知识库的 `vector-index.json` 中。

### 模式 3：完整链路

适合测试当前最完整的 RAG 流程。

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
Qdrant collection: 留空自动生成，或填写 rag_test
Qdrant key env: 本地 Qdrant 留空；Qdrant Cloud 填 QDRANT_API_KEY

Rerank provider: Qwen3 Rerank
Rerank model: qwen3-rerank
Rerank URL: https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks
Rerank key env: DASHSCOPE_API_KEY
Rerank top N: 5
```

将 `{WorkspaceId}` 替换为阿里云百炼 / Model Studio 的工作空间 ID。

## 环境变量

可以从 `.env.example` 创建 `.env`，然后填写需要的 key：

```dotenv
ZHIPU_API_KEY=your-zhipu-api-key
DASHSCOPE_API_KEY=your-dashscope-api-key
QDRANT_API_KEY=
```

重要：UI 中保存的是环境变量名，不是真实密钥。

例如 Knowledge 页面应填写：

```text
Embedding API key env: ZHIPU_API_KEY
Rerank API key env: DASHSCOPE_API_KEY
Qdrant key env: QDRANT_API_KEY
```

修改 `.env` 后需要重启后端：

```bash
npm run dev
```

## Qdrant 配置

本地 Qdrant 需要 Docker Desktop。

启动 Qdrant：

```bash
docker compose --env-file docker/qdrant.env up -d qdrant
```

验证：

```bash
curl http://localhost:6333/collections
```

Dashboard：

```text
http://localhost:6333/dashboard
```

项目使用专用 `docker/qdrant.env`，避免 Docker Compose 误读应用 `.env` 中的多行 `MODELS_CONFIG`。

## 配置分区

### Recall

Recall 控制 rerank 之前如何召回候选内容。

| UI 名称 | 字段 | 含义 |
| --- | --- | --- |
| Retrieval strategy | `retrievalStrategy` | 查询时的检索方式：`keyword`、`vector`、`hybrid`。 |
| Index method | `indexMethod` | 索引文件时生成的索引类型：`keyword`、`vector`、`hybrid`。 |
| Top K | `topK` | 初召回阶段取多少个候选 chunk。 |
| Max chars | `maxChars` | 返回或注入的最大字符数预算。 |
| Score threshold | `scoreThreshold` | 最低分数门槛。低置信 chunk 可以被跳过注入。 |

推荐初始值：

```text
topK: 5-20
maxChars: 8000
scoreThreshold: 普通测试用 0；测试无关问题时可设为 0.45+
```

### Embedding

Embedding 将文本 chunk 和 query 转为向量。`vector` 和 `hybrid` 检索需要它。

| UI 名称 | 字段 | 含义 |
| --- | --- | --- |
| Provider | `embeddingProvider` | `none`、`zhipu_embedding_3` 或 `openai_compatible`。 |
| Model | `embeddingModel` | 发送给 embedding API 的模型 ID。 |
| Dimensions | `embeddingDimensions` | 向量维度。必须和 provider/model 输出一致。 |
| Embedding URL | `embeddingBaseUrl` | Embedding API 地址。 |
| API key env | `embeddingApiKeyEnv` | 保存 API key 的环境变量名。 |

当前支持的 embedding provider：

| Provider | Model | URL | Dimensions |
| --- | --- | --- | --- |
| `zhipu_embedding_3` | `embedding-3` | `https://open.bigmodel.cn/api/paas/v4/embeddings` | `1024` |
| `openai_compatible` | provider-specific | provider-specific `/embeddings` URL | provider-specific |

Index 前建议先点击 `Test Embedding`。

### Vector Store

Vector Store 控制向量持久化在哪里。

| UI 名称 | 字段 | 含义 |
| --- | --- | --- |
| Store | `vectorStore` | `local_json` 或 `qdrant`。 |
| Qdrant URL | `qdrantUrl` | Qdrant API 地址。 |
| Collection | `qdrantCollection` | Qdrant collection 名称。留空则按 KB 自动生成。 |
| API key env | `qdrantApiKeyEnv` | Qdrant Cloud 的 API key 环境变量名。本地 Docker 通常留空。 |

说明：

- `local_json` 最适合本地快速开发。
- `qdrant` 更接近真实向量数据库路径。
- 修改 vector store 或 embedding 配置后，需要重新 Index 文件。

### Rerank

Rerank 是对初召回 chunks 的可选二次排序。

| UI 名称 | 字段 | 含义 |
| --- | --- | --- |
| Provider | `rerankProvider` | `none` 或 `qwen3_rerank`。 |
| Model | `rerankModel` | Rerank 模型 ID。当前默认 `qwen3-rerank`。 |
| Top N | `rerankTopN` | Rerank 后保留多少个 chunk。通常小于或等于 `topK`。 |
| Rerank URL | `rerankBaseUrl` | Rerank API 地址。 |
| API key env | `rerankApiKeyEnv` | 保存 rerank API key 的环境变量名。 |
| Instruct | `rerankInstruct` | 发送给 rerank 模型的任务说明。 |

当前支持的 rerank provider：

| Provider | Model | URL |
| --- | --- | --- |
| `qwen3_rerank` | `qwen3-rerank` | `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks` |

启用后建议先点击 `Test Rerank`。

## 支持的文件类型

当前支持：

- Markdown：`.md`、`.markdown`
- Text：`.txt`
- JSON：`.json`
- CSV：`.csv`
- PDF：`.pdf`
- Word：`.docx`

PDF 和 DOCX 当前采用轻量文本提取。版面感知解析、表格结构恢复、OCR、多模态解析属于后续方向。

## Runtime Strategy

Knowledge 挂载支持三种运行策略：

| Strategy | 含义 |
| --- | --- |
| Auto RAG | 每轮用户消息自动从已挂载知识库检索。 |
| Agentic RAG | 固定挂载清单，并暴露知识库工具，由 agent 判断何时查询。 |
| Manual Lab | 只在 Knowledge 页面测试检索，不改变对话上下文。 |

Context Inspector 会分层展示：

- Mounted Knowledge Manifest：稳定挂载清单。
- Retrieved Knowledge：本轮动态检索结果。
- Messages Payload：最终发送给模型的消息。
- Provider Tool Schema：暴露给模型的工具 schema。

## 推荐测试步骤

1. 配置 `.env`。
2. 重启 `npm run dev`。
3. 如果使用 Qdrant，启动 Docker 和 Qdrant。
4. 打开 Knowledge 页面。
5. 创建或选择一个 Knowledge Base。
6. 填写 Retrieval Quality 配置。
7. 点击 `Test Embedding`。
8. 如果启用 rerank，点击 `Test Rerank`。
9. 点击 `Save Retrieval Settings`。
10. 选择文件并点击 `Index`。
11. 运行 `Retrieval Test`。
12. 挂载知识库，在对话中测试。
13. 打开 Context Inspector 确认实际发送了什么。

## 常见问题

### Index 时出现 `fetch failed`

常见原因：

- 选择了 Qdrant，但 Qdrant 未运行。
- Embedding URL 不可达。
- 网络或代理问题。

检查 Qdrant：

```bash
curl http://localhost:6333/collections
```

如果暂时不需要 Qdrant，可切换 Vector Store 为 `Local JSON`。

### Qdrant collection already exists

重新 Index 同一个 collection 时这是正常情况。当前代码已将 Qdrant `409` 视为幂等成功，并继续 upsert points。

如果仍看到这个错误，请重启 dev server，并确认当前分支包含 Qdrant 幂等修复。

### Rerank 401 / invalid API key

检查：

- `.env` 中是否是正确的 `DASHSCOPE_API_KEY`。
- UI 中填写的是 `DASHSCOPE_API_KEY`，不是原始 key。
- 修改 `.env` 后是否重启后端。
- API key 是否属于同一个阿里云百炼 / Model Studio workspace。
- key 是否少字符或多字符。

### Embedding 401 / invalid API key

检查：

- `.env` 中是否有 `ZHIPU_API_KEY`。
- UI 中填写的是 `ZHIPU_API_KEY`。
- 修改 `.env` 后是否重启后端。

### 无关问题也召回了 chunk

向量检索默认会返回 nearest neighbors。可以提高：

```text
Score threshold: 0.45 或更高
```

然后在 Context Inspector 中检查。低置信 retrieved knowledge 应该可观察，但不会注入模型。

### 改了配置但结果没变化

修改 `embeddingProvider`、`embeddingModel`、`embeddingDimensions`、`vectorStore` 或 `qdrantCollection` 后，需要重新 Index 文件。旧文件不会自动重新向量化。

