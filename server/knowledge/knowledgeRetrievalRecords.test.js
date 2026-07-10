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

test('records retrieval evaluation summaries for comparison without chunk text', async (t) => {
	const { rootDir } = await createFixture(t);
	const kb = await createKnowledgeBase({ name: 'Docs', knowledgeRoot: rootDir });

	await recordKnowledgeRetrieval({
		knowledgeBaseId: kb.id,
		query: 'rag feature name',
		strategy: 'hybrid',
		resultCount: 1,
		settings: {
			topK: 5,
			maxChars: 8000,
			scoreThreshold: 0.45,
			rerankProvider: 'qwen3_rerank',
			rerankTopN: 3,
		},
		evaluation: {
			rerankEnabled: true,
			initialCount: 2,
			rerankedCount: 2,
			finalCount: 1,
			injectedCount: 1,
			skippedCount: 1,
			topScore: 0.91,
			topScoreType: 'rerank',
			initialTop: [
				{ id: 'chunk_a', score: 0.5, scoreType: 'vector', source: { filename: 'a.md' }, text: 'do not save this' },
			],
			rerankedTop: [
				{ id: 'chunk_b', score: 0.91, scoreType: 'rerank', originalScore: 0.4, source: { filename: 'b.md' }, text: 'also secret' },
			],
			finalTop: [
				{ id: 'chunk_b', score: 0.91, scoreType: 'rerank', source: { filename: 'b.md' }, text: 'final secret' },
			],
		},
		sources: [{ filename: 'b.md', chunkCount: 1 }],
		knowledgeRoot: rootDir,
		now: () => new Date('2026-07-06T10:00:00.000Z'),
	});

	const [record] = await listKnowledgeRetrievalRecords({
		knowledgeBaseId: kb.id,
		knowledgeRoot: rootDir,
	});

	assert.equal(record.strategy, 'hybrid');
	assert.equal(record.settings.rerankProvider, 'qwen3_rerank');
	assert.equal(record.evaluation.rerankEnabled, true);
	assert.equal(record.evaluation.initialCount, 2);
	assert.equal(record.evaluation.finalCount, 1);
	assert.equal(record.evaluation.topScore, 0.91);
	assert.deepEqual(record.evaluation.rerankedTop.map(item => item.id), ['chunk_b']);
	assert.equal(record.evaluation.rerankedTop[0].filename, 'b.md');
	assert.equal(record.evaluation.rerankedTop[0].text, undefined);
	assert.equal(JSON.stringify(record).includes('secret'), false);
});
