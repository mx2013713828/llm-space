import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  getKnowledgePipelineTrace,
  recordKnowledgePipelineEvent,
} from './knowledgePipelineTrace.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'knowledge-trace-'));
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir };
}

test('recordKnowledgePipelineEvent stores bounded stage summaries', async (t) => {
  const { rootDir } = await createFixture(t);

  await recordKnowledgePipelineEvent({
    knowledgeBaseId: 'kb_docs',
    runId: 'run_1',
    stage: 'parse',
    status: 'completed',
    summary: 'x'.repeat(1000),
    knowledgeRoot: rootDir,
    now: () => new Date('2026-07-05T10:00:00.000Z'),
  });

  const trace = await getKnowledgePipelineTrace({
    knowledgeBaseId: 'kb_docs',
    runId: 'run_1',
    knowledgeRoot: rootDir,
  });

  assert.equal(trace.events.length, 1);
  assert.equal(trace.events[0].stage, 'parse');
  assert.equal(trace.events[0].summary.length, 500);
});
