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
		embeddingBaseUrl: '',
		embeddingApiKeyEnv: '',
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
		embeddingBaseUrl: '',
		embeddingApiKeyEnv: '',
	});
});

test('zhipu_embedding_3 calls an OpenAI-compatible embeddings API without storing raw keys', async () => {
	const calls = [];
	const result = await embedKnowledgeTexts({
		texts: ['alpha', 'beta'],
		settings: {
			embeddingProvider: 'zhipu_embedding_3',
			embeddingApiKeyEnv: 'ZHIPU_API_KEY',
			embeddingDimensions: 4,
		},
		env: { ZHIPU_API_KEY: 'secret-key' },
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			return {
				ok: true,
				json: async () => ({
					data: [
						{ index: 1, embedding: [0, 1, 0, 0] },
						{ index: 0, embedding: [1, 0, 0, 0] },
					],
				}),
			};
		},
	});

	assert.equal(result.embeddingProvider, 'zhipu_embedding_3');
	assert.equal(result.embeddingModel, 'embedding-3');
	assert.equal(result.embeddingDimensions, 256);
	assert.deepEqual(result.vectors, [[1, 0, 0, 0], [0, 1, 0, 0]]);
	assert.equal(calls[0].url, 'https://open.bigmodel.cn/api/paas/v4/embeddings');
	assert.equal(calls[0].options.headers.authorization, 'Bearer secret-key');
	assert.equal(JSON.parse(calls[0].options.body).model, 'embedding-3');
});
