import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { registerKnowledgeRoutes } from './knowledgeRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'knowledge-routes-'));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir };
}

test('knowledge routes create, ingest, retrieve, mount, and list mounted bases', async (t) => {
  const { rootDir } = await createFixture(t);
  const app = createRouteApp();
  registerKnowledgeRoutes(app, { knowledgeRoot: rootDir });

  const createRes = await dispatchJson(app, 'POST', '/api/knowledge-bases', {
    body: { name: 'Docs', description: 'Project docs' },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.name, 'Docs');

  const updateRes = await dispatchJson(app, 'PATCH', `/api/knowledge-bases/${createRes.body.id}`, {
    body: {
      settings: {
        topK: 3,
        maxChars: 1600,
        scoreThreshold: 0.5,
        retrievalStrategy: 'keyword',
      },
    },
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.id, createRes.body.id);
  assert.equal(updateRes.body.settings.topK, 3);
  assert.equal(updateRes.body.settings.maxChars, 1600);
  assert.equal(updateRes.body.settings.scoreThreshold, 0.5);
  assert.equal(updateRes.body.settings.retrievalStrategy, 'keyword');

  const ingestRes = await dispatchJson(app, 'POST', `/api/knowledge-bases/${createRes.body.id}/files`, {
    body: {
      filename: 'notes.md',
      mimeType: 'text/markdown',
      content: '# Agent\n\nLLM Space supports observable RAG.',
      settings: { chunkSize: 200 },
    },
  });
  assert.equal(ingestRes.status, 200);
  assert.equal(ingestRes.body.chunks.length, 1);
  assert.equal(ingestRes.body.chunkCount, 1);
  assert.equal(ingestRes.body.totalChunkCount, 1);
  assert.equal(ingestRes.body.knowledgeBase.fileCount, 1);
  assert.equal(ingestRes.body.knowledgeBase.chunkCount, 1);

  const filesRes = await dispatchJson(app, 'GET', `/api/knowledge-bases/${createRes.body.id}/files`);
  assert.equal(filesRes.status, 200);
  assert.deepEqual(filesRes.body.map(file => file.filename), ['notes.md']);

  const retrieveRes = await dispatchJson(app, 'POST', '/api/knowledge-bases/retrieve', {
    body: { knowledgeBaseIds: [createRes.body.id], query: 'observable rag' },
  });
  assert.equal(retrieveRes.status, 200);
  assert.equal(retrieveRes.body.effectiveSettings.strategy, 'keyword');
  assert.equal(retrieveRes.body.chunks[0].source.filename, 'notes.md');

  const recordsRes = await dispatchJson(app, 'GET', `/api/knowledge-bases/${createRes.body.id}/retrieval-records`);
  assert.equal(recordsRes.status, 200);
  assert.equal(recordsRes.body.length, 1);
  assert.equal(recordsRes.body[0].query, 'observable rag');
  assert.equal(recordsRes.body[0].resultCount, 1);

  const mountRes = await dispatchJson(app, 'POST', '/api/harnesses/alpha/knowledge-bases', {
    body: { knowledgeBaseIds: [createRes.body.id] },
  });
  assert.equal(mountRes.status, 200);
  assert.deepEqual(mountRes.body.knowledgeBaseIds, [createRes.body.id]);

  const mountedRes = await dispatchJson(app, 'GET', '/api/harnesses/alpha/knowledge-bases');
  assert.equal(mountedRes.status, 200);
  assert.deepEqual(mountedRes.body.map(item => item.id), [createRes.body.id]);

  const deleteRes = await dispatchJson(app, 'DELETE', `/api/knowledge-bases/${createRes.body.id}`);
  assert.equal(deleteRes.status, 200);
});
