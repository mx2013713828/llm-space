import test from 'node:test';
import assert from 'node:assert/strict';

import {
	isRerankEnabled,
	normalizeRerankSettings,
	rerankKnowledgeChunks,
} from './rerankProviders.js';

test('normalizeRerankSettings defaults to disabled rerank', () => {
	assert.deepEqual(normalizeRerankSettings({}), {
		rerankProvider: 'none',
		rerankModel: '',
		rerankBaseUrl: '',
		rerankApiKeyEnv: '',
		rerankTopN: 0,
		rerankInstruct: '',
	});
	assert.equal(isRerankEnabled({}), false);
});

test('qwen3_rerank settings normalize model and env references', () => {
	const settings = normalizeRerankSettings({
		rerankProvider: 'qwen3_rerank',
		rerankBaseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks',
		rerankApiKeyEnv: 'DASHSCOPE_API_KEY',
		rerankTopN: 999,
	});

	assert.equal(settings.rerankProvider, 'qwen3_rerank');
	assert.equal(settings.rerankModel, 'qwen3-rerank');
	assert.equal(settings.rerankApiKeyEnv, 'DASHSCOPE_API_KEY');
	assert.equal(settings.rerankTopN, 100);
	assert.match(settings.rerankInstruct, /retrieve relevant passages/);
});

test('rerankKnowledgeChunks calls qwen3-rerank compatible API and reorders chunks', async () => {
	const calls = [];
	const chunks = [
		{ id: 'a', text: 'Mount Everest is the highest mountain.', score: 0.2 },
		{ id: 'b', text: 'LLM Space feature is Mountable Knowledge Bases.', score: 0.8 },
		{ id: 'c', text: 'Weather forecast unrelated.', score: 0.3 },
	];

	const result = await rerankKnowledgeChunks({
		query: 'What is the highest mountain?',
		chunks,
		topN: 2,
		settings: {
			rerankProvider: 'qwen3_rerank',
			rerankBaseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks',
			rerankApiKeyEnv: 'DASHSCOPE_API_KEY',
		},
		env: { DASHSCOPE_API_KEY: 'dashscope-secret' },
		fetchImpl: async (url, options) => {
			calls.push({ url, options });
			return {
				ok: true,
				json: async () => ({
					results: [
						{ index: 0, relevance_score: 0.91 },
						{ index: 2, relevance_score: 0.18 },
					],
					usage: { total_tokens: 42 },
				}),
			};
		},
	});

	assert.equal(result.rerankProvider, 'qwen3_rerank');
	assert.deepEqual(result.chunks.map(chunk => chunk.id), ['a', 'c']);
	assert.equal(result.chunks[0].scoreType, 'rerank');
	assert.equal(result.chunks[0].originalScore, 0.2);
	assert.equal(result.chunks[0].rerankScore, 0.91);
	assert.deepEqual(result.usage, { total_tokens: 42 });
	assert.equal(calls[0].url, 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks');
	assert.equal(calls[0].options.headers.authorization, 'Bearer dashscope-secret');
	const body = JSON.parse(calls[0].options.body);
	assert.equal(body.model, 'qwen3-rerank');
	assert.equal(body.query, 'What is the highest mountain?');
	assert.equal(body.top_n, 2);
	assert.deepEqual(body.documents, chunks.map(chunk => chunk.text));
});

test('rerankKnowledgeChunks reports missing API key clearly', async () => {
	await assert.rejects(
		() => rerankKnowledgeChunks({
			query: 'q',
			chunks: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
			settings: {
				rerankProvider: 'qwen3_rerank',
				rerankBaseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks',
				rerankApiKeyEnv: 'DASHSCOPE_API_KEY',
			},
			env: {},
		}),
		/Missing rerank API key env/,
	);
});
