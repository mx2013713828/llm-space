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
  assert.equal(ingestRes.body.knowledgeBase.fileCount, 1);
  assert.equal(ingestRes.body.knowledgeBase.chunkCount, 1);

  const retrieveRes = await dispatchJson(app, 'POST', '/api/knowledge-bases/retrieve', {
    body: { knowledgeBaseIds: [createRes.body.id], query: 'observable rag' },
  });
  assert.equal(retrieveRes.status, 200);
  assert.equal(retrieveRes.body.chunks[0].source.filename, 'notes.md');

  const mountRes = await dispatchJson(app, 'POST', '/api/harnesses/alpha/knowledge-bases', {
    body: { knowledgeBaseIds: [createRes.body.id] },
  });
  assert.equal(mountRes.status, 200);
  assert.deepEqual(mountRes.body.knowledgeBaseIds, [createRes.body.id]);

  const mountedRes = await dispatchJson(app, 'GET', '/api/harnesses/alpha/knowledge-bases');
  assert.equal(mountedRes.status, 200);
  assert.deepEqual(mountedRes.body.map(item => item.id), [createRes.body.id]);
});
