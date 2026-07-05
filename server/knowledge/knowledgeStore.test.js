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
  assert.equal(kb.fileCount, 0);
  assert.equal(kb.chunkCount, 0);

  const stored = JSON.parse(await readFile(path.join(getKnowledgeBaseDir(kb.id, { knowledgeRoot: rootDir }), 'metadata.json'), 'utf-8'));
  assert.equal(stored.schema, 'llm-space.knowledge_base.v1');

  const list = await listKnowledgeBases({ knowledgeRoot: rootDir });
  assert.deepEqual(list.map(item => item.id), ['kb_project-docs']);
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
