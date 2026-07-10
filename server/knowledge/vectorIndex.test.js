import test from 'node:test';
import assert from 'node:assert/strict';

import { embedWithLocalHash } from './embeddingProviders.js';
import {
	buildVectorIndex,
	cosineSimilarity,
	retrieveFromVectorIndex,
} from './vectorIndex.js';

test('cosineSimilarity scores identical vectors above unrelated vectors', () => {
	const query = embedWithLocalHash('deepseek context');
	const related = embedWithLocalHash('deepseek context');
	const unrelated = embedWithLocalHash('weather forecast');

	assert.equal(Number(cosineSimilarity(query, related).toFixed(6)), 1);
	assert.equal(cosineSimilarity(query, related) > cosineSimilarity(query, unrelated), true);
});

test('buildVectorIndex stores chunk vectors and metadata', () => {
	const chunks = [
		{ id: 'a', text: 'alpha' },
		{ id: 'b', text: 'beta' },
	];
	const vectors = chunks.map(chunk => embedWithLocalHash(chunk.text));
	const index = buildVectorIndex({
		chunks,
		vectors,
		embeddingProvider: 'local_hash',
		embeddingModel: 'local-hash-v1',
		embeddingDimensions: 128,
	});

	assert.equal(index.schema, 'llm-space.knowledge_index.vector.v1');
	assert.equal(index.vectorCount, 2);
	assert.equal(index.embeddingProvider, 'local_hash');
	assert.equal(index.items[0].chunkId, 'a');
});

test('retrieveFromVectorIndex ranks chunks by vector similarity and bounds output', () => {
	const chunks = [
		{ id: 'a', text: 'deepseek model context window', source: { filename: 'a.md' } },
		{ id: 'b', text: 'linyi weather forecast', source: { filename: 'b.md' } },
	];
	const index = buildVectorIndex({
		chunks,
		vectors: chunks.map(chunk => embedWithLocalHash(chunk.text)),
		embeddingProvider: 'local_hash',
		embeddingModel: 'local-hash-v1',
		embeddingDimensions: 128,
	});

	const results = retrieveFromVectorIndex({
		queryVector: embedWithLocalHash('deepseek context'),
		chunks,
		index,
		topK: 1,
	});

	assert.deepEqual(results.map(item => item.id), ['a']);
	assert.equal(results[0].scoreType, 'vector');
});
