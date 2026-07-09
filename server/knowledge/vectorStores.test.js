import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
	persistKnowledgeVectors,
	retrieveKnowledgeVectors,
	normalizeVectorStoreSettings,
} from './vectorStores.js';

async function createFixture(t) {
	const rootDir = await mkdtemp(path.join(tmpdir(), 'knowledge-vector-store-'));
	t.after(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});
	return { rootDir };
}

test('normalizeVectorStoreSettings defaults to local JSON storage', () => {
	assert.deepEqual(normalizeVectorStoreSettings({}), {
		vectorStore: 'local_json',
		qdrantUrl: 'http://localhost:6333',
		qdrantCollection: '',
		qdrantApiKeyEnv: '',
	});
});

test('persistKnowledgeVectors creates qdrant collection and upserts payload points', async (t) => {
	const { rootDir } = await createFixture(t);
	const calls = [];
	const chunks = [
		{
			id: 'chunk_a',
			fileId: 'file_a',
			chunkIndex: 0,
			text: 'DeepSeek context window',
			source: { filename: 'models.md', loader: 'markdown' },
		},
	];
	const vectors = [[1, 0, 0]];

	const index = await persistKnowledgeVectors({
		knowledgeBaseId: 'kb_docs',
		chunks,
		vectors,
		embedding: {
			embeddingProvider: 'zhipu_embedding_3',
			embeddingModel: 'embedding-3',
			embeddingDimensions: 3,
		},
		settings: {
			vectorStore: 'qdrant',
			qdrantUrl: 'http://qdrant.local',
			qdrantCollection: 'docs',
			qdrantApiKeyEnv: 'QDRANT_API_KEY',
		},
		knowledgeRoot: rootDir,
		env: { QDRANT_API_KEY: 'qdrant-secret' },
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			return {
				ok: true,
				json: async () => ({ result: [] }),
				text: async () => '',
			};
		},
	});

	assert.equal(index.vectorStore, 'qdrant');
	assert.equal(index.qdrantCollection, 'docs');
	assert.equal(calls.length, 2);
	assert.equal(calls[0].url, 'http://qdrant.local/collections/docs');
	assert.equal(calls[0].options.headers['api-key'], 'qdrant-secret');
	assert.equal(JSON.parse(calls[0].options.body).vectors.size, 3);
	assert.equal(calls[1].url, 'http://qdrant.local/collections/docs/points?wait=true');
	assert.equal(JSON.parse(calls[1].options.body).points[0].payload.text, 'DeepSeek context window');
});

test('persistKnowledgeVectors treats existing qdrant collection as idempotent', async (t) => {
	const { rootDir } = await createFixture(t);
	const calls = [];

	const index = await persistKnowledgeVectors({
		knowledgeBaseId: 'kb_docs',
		chunks: [{
			id: 'chunk_a',
			fileId: 'file_a',
			chunkIndex: 0,
			text: 'Mountable Knowledge Bases',
			source: { filename: 'rag.md' },
		}],
		vectors: [[0.1, 0.2, 0.3]],
		embedding: {
			embeddingProvider: 'zhipu_embedding_3',
			embeddingModel: 'embedding-3',
			embeddingDimensions: 3,
		},
		settings: {
			vectorStore: 'qdrant',
			qdrantUrl: 'http://qdrant.local',
			qdrantCollection: 'docs',
		},
		knowledgeRoot: rootDir,
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			if (url.endsWith('/collections/docs')) {
				return {
					ok: false,
					status: 409,
					text: async () => '{"status":{"error":"Collection already exists"}}',
				};
			}
			return {
				ok: true,
				json: async () => ({ result: [] }),
				text: async () => '',
			};
		},
	});

	assert.equal(index.vectorStore, 'qdrant');
	assert.equal(calls.length, 2);
	assert.equal(calls[1].url, 'http://qdrant.local/collections/docs/points?wait=true');
	assert.equal(JSON.parse(calls[1].options.body).points.length, 1);
});

test('retrieveKnowledgeVectors maps qdrant search results back into chunks', async () => {
	const results = await retrieveKnowledgeVectors({
		knowledgeBaseId: 'kb_docs',
		queryVector: [1, 0, 0],
		settings: {
			vectorStore: 'qdrant',
			qdrantUrl: 'http://qdrant.local',
			qdrantCollection: 'docs',
		},
		topK: 1,
		fetchImpl: async (url, options) => {
			assert.equal(url, 'http://qdrant.local/collections/docs/points/search');
			assert.equal(JSON.parse(options.body).limit, 1);
			return {
				ok: true,
				json: async () => ({
					result: [
						{
							id: 'abc',
							score: 0.92,
							payload: {
								chunkId: 'chunk_a',
								fileId: 'file_a',
								chunkIndex: 0,
								text: 'DeepSeek context window',
								source: { filename: 'models.md' },
							},
						},
					],
				}),
			};
		},
	});

	assert.equal(results.length, 1);
	assert.equal(results[0].id, 'chunk_a');
	assert.equal(results[0].scoreType, 'vector');
	assert.equal(results[0].source.filename, 'models.md');
});
