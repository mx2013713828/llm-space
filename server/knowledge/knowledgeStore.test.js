import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseDir,
  listKnowledgeBases,
  loadKnowledgeBase,
  mountKnowledgeBases,
  listMountedKnowledgeBases,
} from './knowledgeStore.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'knowledge-store-'));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir };
}

test('createKnowledgeBase persists path-safe metadata and lists summaries', async (t) => {
  const { rootDir } = await createFixture(t);

  const kb = await createKnowledgeBase({
    name: 'Project Docs',
    description: 'Internal project documents',
    settings: { chunkSize: 800 },
    knowledgeRoot: rootDir,
    now: () => new Date('2026-07-05T10:00:00.000Z'),
  });

  assert.equal(kb.id, 'kb_project-docs');
  assert.equal(kb.name, 'Project Docs');
  assert.equal(kb.description, 'Internal project documents');
  assert.equal(kb.settings.chunkSize, 800);
  assert.equal(kb.settings.indexMethod, 'keyword');
  assert.equal(kb.settings.retrievalStrategy, 'keyword');
  assert.equal(kb.settings.embeddingProvider, 'none');
  assert.equal(kb.settings.embeddingModel, '');
  assert.equal(kb.settings.rerankProvider, 'none');
  assert.equal(kb.settings.topK, 5);
  assert.equal(kb.fileCount, 0);
  assert.equal(kb.chunkCount, 0);

  const stored = JSON.parse(await readFile(path.join(getKnowledgeBaseDir(kb.id, { knowledgeRoot: rootDir }), 'metadata.json'), 'utf-8'));
  assert.equal(stored.schema, 'llm-space.knowledge_base.v1');

  const list = await listKnowledgeBases({ knowledgeRoot: rootDir });
  assert.deepEqual(list.map(item => item.id), ['kb_project-docs']);
});

test('normalize settings clamps retrieval quality options to supported MVP values', async (t) => {
  const { rootDir } = await createFixture(t);

  const kb = await createKnowledgeBase({
    name: 'Quality',
    settings: {
      indexMethod: 'vector',
      retrievalStrategy: 'hybrid',
      embeddingProvider: 'local_hash',
      rerankProvider: 'qwen3_rerank',
      rerankTopN: 999,
      topK: 0,
      maxChars: -20,
      scoreThreshold: '0.75',
    },
    knowledgeRoot: rootDir,
  });

  assert.equal(kb.settings.indexMethod, 'vector');
  assert.equal(kb.settings.retrievalStrategy, 'hybrid');
  assert.equal(kb.settings.embeddingProvider, 'local_hash');
  assert.equal(kb.settings.embeddingModel, 'local-hash-v1');
  assert.equal(kb.settings.rerankProvider, 'qwen3_rerank');
  assert.equal(kb.settings.rerankModel, 'qwen3-rerank');
  assert.equal(kb.settings.rerankApiKeyEnv, 'DASHSCOPE_API_KEY');
  assert.equal(kb.settings.rerankTopN, 100);
  assert.equal(kb.settings.topK, 1);
  assert.equal(kb.settings.maxChars, 500);
  assert.equal(kb.settings.scoreThreshold, 0.75);
});

test('createKnowledgeBase avoids id collisions and rejects unsafe ids on load/delete', async (t) => {
  const { rootDir } = await createFixture(t);

  const first = await createKnowledgeBase({ name: 'Docs', knowledgeRoot: rootDir });
  const second = await createKnowledgeBase({ name: 'Docs', knowledgeRoot: rootDir });

  assert.equal(first.id, 'kb_docs');
  assert.equal(second.id, 'kb_docs-2');
  await assert.rejects(
    () => loadKnowledgeBase({ knowledgeBaseId: '../kb_docs', knowledgeRoot: rootDir }),
    /Invalid knowledgeBaseId/,
  );
  await assert.rejects(
    () => deleteKnowledgeBase({ knowledgeBaseId: '../kb_docs', knowledgeRoot: rootDir }),
    /Invalid knowledgeBaseId/,
  );
});

test('mountKnowledgeBases stores harness mounts independently from knowledge metadata', async (t) => {
  const { rootDir } = await createFixture(t);
  const kb = await createKnowledgeBase({ name: 'Mounted Docs', knowledgeRoot: rootDir });

  await mountKnowledgeBases({
    harnessId: 'alpha',
    knowledgeBaseIds: [kb.id, 'missing', kb.id],
    knowledgeRoot: rootDir,
  });

  assert.deepEqual(await listMountedKnowledgeBases({ harnessId: 'alpha', knowledgeRoot: rootDir }), [kb.id]);
  assert.deepEqual(await listMountedKnowledgeBases({ harnessId: '../alpha', knowledgeRoot: rootDir }), []);
});
