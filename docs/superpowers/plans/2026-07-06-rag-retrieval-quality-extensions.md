# RAG Retrieval Quality Extensions Plan

> Task 16 implementation plan. Keep each slice independently testable and removable. Do not turn the local Knowledge Base MVP into a heavyweight RAG platform in one step.

## Goal

Improve retrieval quality while preserving LLM Space's experimental-platform principle: every retrieval mechanism should be configurable, observable, and easy to swap.

## Architecture Direction

Task 16 extends the existing keyword RAG MVP in layers:

1. Retrieval settings contract and UI.
2. Retrieval records and pipeline observability.
3. Document loader adapters for richer file formats.
4. Embedding provider abstraction.
5. Vector index abstraction.
6. Hybrid retrieval and rerank adapters.
7. Parent-child retrieval and evaluation hooks.

The agent loop must not know provider-specific embedding details. It should continue calling `retrieveKnowledge(...)`; retrieval internals decide keyword/vector/hybrid behavior.

## Phase 1 MVP

Phase 1 deliberately avoids external embedding calls. It makes the existing keyword path more explicit and prepares interfaces for later vector work.

### Deliverables

- Knowledge Base metadata stores retrieval settings:
  - `retrievalStrategy`: initially `keyword`
  - `indexMethod`: initially `keyword`
  - `topK`
  - `maxChars`
  - `scoreThreshold`
- Add a Knowledge Base settings update API.
- Retrieval returns effective settings in its response.
- Retrieval lab and runtime retrieval record bounded metadata:
  - query
  - strategy
  - target knowledge base ids
  - result count
  - source file names
  - created timestamp
- Knowledge page exposes per-base retrieval settings and recent retrieval records.

### Non-Goals For Phase 1

- Real embedding provider calls.
- Vector index persistence.
- Hybrid ranking.
- Rerank model adapters.
- PDF/DOCX parsing.

Those come after the retrieval settings and observability contract is stable.

## Phase 1 File Targets

- Modify `server/knowledge/knowledgeStore.js`
- Modify `server/knowledge/knowledgeRetrieve.js`
- Create `server/knowledge/knowledgeRetrievalRecords.js`
- Test `server/knowledge/knowledgeRetrievalRecords.test.js`
- Modify `server/routes/knowledgeRoutes.js`
- Test `server/routes/knowledgeRoutes.test.js`
- Modify `src/pages/KnowledgePage.jsx`
- Modify `src/lib/knowledgeBases.js`
- Test `src/lib/knowledgeBases.test.js`
- Modify `src/App.css`

## Phase 1 Steps

- [x] Add retrieval settings defaults and normalization tests.
- [x] Add PATCH Knowledge Base settings route.
- [x] Add retrieval records store and tests.
- [x] Make `retrieveKnowledge` return `effectiveSettings` and optionally record retrieval metadata.
- [x] Add Knowledge page controls for per-base retrieval settings.
- [x] Add recent retrieval records panel.
- [x] Run `npm test` and `npm run build`.
- [x] Commit implementation slices:
  - `feat: add knowledge retrieval settings contract`
  - `feat: record knowledge retrieval metadata`
  - `feat: expose rag retrieval quality controls`

## Later Phases

### Phase 2: Document Loaders

- [x] Add `documentLoaders.js`.
- [x] Route current Markdown/text/JSON through loader adapters.
- [x] Add CSV loader behind tests and UI file selection.
- [x] Add lightweight PDF text extraction through `pdf-parse`.
- [x] Add lightweight DOCX text extraction through `mammoth`.
- [x] Send file uploads as base64 so binary formats are not corrupted in transit.
- [x] Preserve compatibility through `parseKnowledgeFile`.
- [x] Run `npm test` and `npm run build`.

### Phase 3: Embedding Providers

- [x] Add `embeddingProviders.js`.
- [x] Add deterministic local embedding provider: `local_hash`.
- [x] Store embedding provider/model in KB metadata.
- [x] Build vector index during ingest when embeddings are enabled.
- [x] Add Knowledge UI controls for embedding provider, index method, and retrieval strategy.
- [x] Add unit and ingest tests for embedding/vector behavior.
- [x] Support OpenAI-compatible embedding API with fake HTTP tests.
- [x] Add first real provider preset: Zhipu `embedding-3`.
- [x] Store remote provider config as references, not raw secrets in KB files.
- [x] Add `test-embedding` API and Knowledge UI test action.

### Phase 4: Retrieval Quality Gates And Evaluation

- [x] Add `vectorIndex.js`.
- [x] Store vectors separately from chunks in `vector-index.json`.
- [x] Add `retrieveKnowledge({ strategy: 'keyword' | 'vector' | 'hybrid' })`.
- [x] Add `vectorStores.js` with local JSON and Qdrant adapters.
- [x] Add Qdrant collection/upsert/search tests with fake HTTP.
- [x] Add Auto RAG confidence gate so low-score vector/hybrid results are observable but not injected.
- [x] Show skipped retrieved knowledge in Context Inspector as `sentToModel: false`.
- [ ] Add stronger hybrid weighting controls and comparison records.
- [ ] Add retrieval evaluation records with injected/skipped decisions and top-score traces.

### Phase 5: Rerank And Evaluation

- Add rerank adapter interface.
- Add retrieval evaluation records and comparison view.
- Keep rerank optional and bounded.
