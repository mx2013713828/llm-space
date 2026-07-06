import test from 'node:test';
import assert from 'node:assert/strict';

import {
	embedKnowledgeTexts,
	embedWithLocalHash,
	isEmbeddingEnabled,
	normalizeEmbeddingSettings,
} from './embeddingProviders.js';

test('normalizeEmbeddingSettings defaults to disabled embeddings', () => {
	assert.deepEqual(normalizeEmbeddingSettings({}), {
		embeddingProvider: 'none',
		embeddingModel: '',
		embeddingDimensions: 0,
	});
	assert.equal(isEmbeddingEnabled({}), false);
});

test('local_hash provider creates deterministic normalized vectors', async () => {
	const first = embedWithLocalHash('deepseek context window');
	const second = embedWithLocalHash('deepseek context window');
	const different = embedWithLocalHash('weather forecast linyi');

	assert.deepEqual(first, second);
	assert.equal(first.length, 128);
	assert.notDeepEqual(first, different);

	const result = await embedKnowledgeTexts({
		texts: ['deepseek context', 'linyi weather'],
		settings: { embeddingProvider: 'local_hash' },
	});
	assert.equal(result.embeddingProvider, 'local_hash');
	assert.equal(result.embeddingModel, 'local-hash-v1');
	assert.equal(result.embeddingDimensions, 128);
	assert.equal(result.vectors.length, 2);
});

test('unknown embedding providers are safely disabled', () => {
	assert.deepEqual(normalizeEmbeddingSettings({ embeddingProvider: 'remote-mystery' }), {
		embeddingProvider: 'none',
		embeddingModel: '',
		embeddingDimensions: 0,
	});
});
