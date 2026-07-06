import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { createKnowledgeBase } from './knowledgeStore.js';
import {
	listKnowledgeRetrievalRecords,
	recordKnowledgeRetrieval,
} from './knowledgeRetrievalRecords.js';

async function createFixture(t) {
	const rootDir = await mkdtemp(path.join(tmpdir(), 'knowledge-retrieval-records-'));
	t.after(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});
	return { rootDir };
}

test('records bounded retrieval metadata without storing chunk text', async (t) => {
	const { rootDir } = await createFixture(t);
	const kb = await createKnowledgeBase({ name: 'Docs', knowledgeRoot: rootDir });

	await recordKnowledgeRetrieval({
		knowledgeBaseId: kb.id,
		query: 'observable rag',
		strategy: 'keyword',
		resultCount: 2,
		sources: [
			{ filename: 'notes.md', chunkCount: 1 },
			{ filename: 'design.md', chunkCount: 1 },
		],
		chunks: [{ text: 'large chunk content should not be persisted' }],
		knowledgeRoot: rootDir,
		now: () => new Date('2026-07-06T10:00:00.000Z'),
	});

	const records = await listKnowledgeRetrievalRecords({
		knowledgeBaseId: kb.id,
		knowledgeRoot: rootDir,
	});

	assert.equal(records.length, 1);
	assert.equal(records[0].query, 'observable rag');
	assert.equal(records[0].strategy, 'keyword');
	assert.equal(records[0].resultCount, 2);
	assert.deepEqual(records[0].sources.map(source => source.filename), ['notes.md', 'design.md']);
	assert.equal(JSON.stringify(records).includes('large chunk content'), false);
});
