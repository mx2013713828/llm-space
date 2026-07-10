import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { createKnowledgeBase, loadKnowledgeBase, loadKnowledgeVectorIndex } from './knowledgeStore.js';
import { ingestKnowledgeFile, previewKnowledgeChunks } from './knowledgeIngest.js';
import { retrieveKnowledge } from './knowledgeRetrieve.js';
import { listKnowledgeRetrievalRecords } from './knowledgeRetrievalRecords.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'knowledge-ingest-'));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir };
}

test('previewKnowledgeChunks parses and chunks without persisting', async (t) => {
  const { rootDir } = await createFixture(t);

  const preview = await previewKnowledgeChunks({
    filename: 'notes.md',
    mimeType: 'text/markdown',
    content: '# RAG\n\nRetrieval augmented generation.',
    settings: { chunkSize: 200, overlap: 0 },
    knowledgeRoot: rootDir,
  });

  assert.equal(preview.length, 1);
  assert.equal(preview[0].source.filename, 'notes.md');
  assert.match(preview[0].text, /Retrieval augmented generation/);
});

test('ingestKnowledgeFile persists file metadata, chunks, index, and trace events', async (t) => {
  const { rootDir } = await createFixture(t);
  const kb = await createKnowledgeBase({ name: 'Docs', knowledgeRoot: rootDir });

  const result = await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'weather.md',
    mimeType: 'text/markdown',
    content: '# 临沂天气\n\n临沂 humidity weather forecast',
    settings: { chunkSize: 200, overlap: 0 },
    knowledgeRoot: rootDir,
  });

  assert.equal(result.file.filename, 'weather.md');
  assert.equal(result.chunks.length, 1);

  const updated = await loadKnowledgeBase({ knowledgeBaseId: kb.id, knowledgeRoot: rootDir });
  assert.equal(updated.fileCount, 1);
  assert.equal(updated.chunkCount, 1);

  const retrieval = await retrieveKnowledge({
    knowledgeBaseIds: [kb.id],
    query: '临沂 weather',
    topK: 3,
    knowledgeRoot: rootDir,
  });
  assert.equal(retrieval.chunks.length, 1);
  assert.equal(retrieval.chunks[0].source.filename, 'weather.md');
});

test('ingestKnowledgeFile loads CSV through document loader adapters', async (t) => {
  const { rootDir } = await createFixture(t);
  const kb = await createKnowledgeBase({ name: 'Models', knowledgeRoot: rootDir });

  const result = await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'models.csv',
    mimeType: 'text/csv',
    content: 'name,context\nDeepSeek V4,1000000\nKimi,128000',
    settings: { chunkSize: 400, overlap: 0 },
    knowledgeRoot: rootDir,
  });

  assert.equal(result.file.parser, 'csv');
  assert.equal(result.file.loader, 'csv');
  assert.equal(result.chunks.length, 1);
  assert.match(result.chunks[0].text, /name: DeepSeek V4/);

  const retrieval = await retrieveKnowledge({
    knowledgeBaseIds: [kb.id],
    query: 'DeepSeek context',
    knowledgeRoot: rootDir,
  });
  assert.equal(retrieval.chunks.length, 1);
  assert.equal(retrieval.chunks[0].source.filename, 'models.csv');
});

test('ingestKnowledgeFile builds vector index when embedding provider is enabled', async (t) => {
  const { rootDir } = await createFixture(t);
  const kb = await createKnowledgeBase({
    name: 'Vector Docs',
    settings: {
      embeddingProvider: 'local_hash',
      indexMethod: 'vector',
      retrievalStrategy: 'vector',
    },
    knowledgeRoot: rootDir,
  });

  await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'models.md',
    mimeType: 'text/markdown',
    content: '# Models\n\nDeepSeek context window supports long prompts.',
    settings: {
      chunkSize: 300,
      overlap: 0,
      embeddingProvider: 'local_hash',
      indexMethod: 'vector',
      retrievalStrategy: 'vector',
    },
    knowledgeRoot: rootDir,
  });

  const vectorIndex = await loadKnowledgeVectorIndex({ knowledgeBaseId: kb.id, knowledgeRoot: rootDir });
  assert.equal(vectorIndex.embeddingProvider, 'local_hash');
  assert.equal(vectorIndex.vectorCount, 1);

  const retrieval = await retrieveKnowledge({
    knowledgeBaseIds: [kb.id],
    query: 'DeepSeek long context',
    strategy: 'vector',
    knowledgeRoot: rootDir,
  });
  assert.equal(retrieval.effectiveSettings.strategy, 'vector');
  assert.equal(retrieval.chunks.length, 1);
  assert.equal(retrieval.chunks[0].scoreType, 'vector');
});

test('retrieveKnowledge reranks initially retrieved chunks with Qwen-compatible API', async (t) => {
  const { rootDir } = await createFixture(t);
  const rerankSettings = {
    chunkSize: 300,
    overlap: 0,
    retrievalStrategy: 'keyword',
    rerankProvider: 'qwen3_rerank',
    rerankModel: 'qwen3-rerank',
    rerankBaseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks',
    rerankApiKeyEnv: 'DASHSCOPE_API_KEY',
    rerankTopN: 2,
  };
  const kb = await createKnowledgeBase({
    name: 'Rerank Docs',
    settings: rerankSettings,
    knowledgeRoot: rootDir,
  });

  await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'mountable.md',
    mimeType: 'text/markdown',
    content: 'answer Mountable Knowledge Bases is the current experimental RAG feature.',
    settings: rerankSettings,
    knowledgeRoot: rootDir,
  });
  await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'mountain.md',
    mimeType: 'text/markdown',
    content: 'answer Mount Everest is the highest mountain on Earth.',
    settings: rerankSettings,
    knowledgeRoot: rootDir,
  });

  const retrieval = await retrieveKnowledge({
    knowledgeBaseIds: [kb.id],
    query: 'answer',
    topK: 2,
    rerank: true,
    knowledgeRoot: rootDir,
    env: { DASHSCOPE_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      assert.equal(url, rerankSettings.rerankBaseUrl);
      assert.equal(options.headers.authorization, 'Bearer test-key');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'qwen3-rerank');
      assert.equal(body.top_n, 2);
      const mountableIndex = body.documents.findIndex(document => document.includes('Mountable Knowledge Bases'));
      const otherIndex = mountableIndex === 0 ? 1 : 0;
      return {
        ok: true,
        json: async () => ({
          results: [
            { index: mountableIndex, relevance_score: 0.98 },
            { index: otherIndex, relevance_score: 0.12 },
          ],
          usage: { total_tokens: 42 },
        }),
      };
    },
  });

  assert.equal(retrieval.effectiveSettings.rerankProvider, 'qwen3_rerank');
  assert.equal(retrieval.chunks.length, 2);
  assert.equal(retrieval.chunks[0].scoreType, 'rerank');
  assert.equal(retrieval.chunks[0].rerankScore, 0.98);
  assert.equal(retrieval.chunks[0].originalScore > 0, true);
  assert.match(retrieval.chunks[0].text, /Mountable Knowledge Bases/);
});

test('retrieveKnowledge records initial, reranked, and final result summaries', async (t) => {
  const { rootDir } = await createFixture(t);
  const rerankSettings = {
    chunkSize: 300,
    overlap: 0,
    retrievalStrategy: 'keyword',
    rerankProvider: 'qwen3_rerank',
    rerankModel: 'qwen3-rerank',
    rerankBaseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks',
    rerankApiKeyEnv: 'DASHSCOPE_API_KEY',
    rerankTopN: 2,
  };
  const kb = await createKnowledgeBase({
    name: 'Evaluation Docs',
    settings: rerankSettings,
    knowledgeRoot: rootDir,
  });

  await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'alpha.md',
    mimeType: 'text/markdown',
    content: 'answer alpha notes for retrieval evaluation.',
    settings: rerankSettings,
    knowledgeRoot: rootDir,
  });
  await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'beta.md',
    mimeType: 'text/markdown',
    content: 'answer beta notes should win after rerank.',
    settings: rerankSettings,
    knowledgeRoot: rootDir,
  });

  await retrieveKnowledge({
    knowledgeBaseIds: [kb.id],
    query: 'answer',
    topK: 2,
    rerank: true,
    recordRetrieval: true,
    knowledgeRoot: rootDir,
    env: { DASHSCOPE_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      const betaIndex = body.documents.findIndex(document => document.includes('beta notes'));
      return {
        ok: true,
        json: async () => ({
          results: [
            { index: betaIndex, relevance_score: 0.97 },
            { index: betaIndex === 0 ? 1 : 0, relevance_score: 0.21 },
          ],
        }),
      };
    },
  });

  const [record] = await listKnowledgeRetrievalRecords({
    knowledgeBaseId: kb.id,
    knowledgeRoot: rootDir,
  });
  assert.equal(record.settings.rerankProvider, 'qwen3_rerank');
  assert.equal(record.evaluation.rerankEnabled, true);
  assert.equal(record.evaluation.initialCount, 2);
  assert.equal(record.evaluation.rerankedCount, 2);
  assert.equal(record.evaluation.finalCount, 2);
  assert.equal(record.evaluation.rerankedTop[0].scoreType, 'rerank');
  assert.equal(record.evaluation.rerankedTop[0].filename, 'beta.md');
  assert.equal(JSON.stringify(record).includes('beta notes'), false);
});
