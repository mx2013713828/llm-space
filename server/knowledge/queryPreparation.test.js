import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareRetrievalQuery } from './queryPreparation.js';

test('prepareRetrievalQuery keeps the full user query in raw mode', async () => {
	assert.deepEqual(await prepareRetrievalQuery({
		query: '不要联网，卫霍正式入队',
		config: { mode: 'raw' },
	}), {
		mode: 'raw',
		originalQuery: '不要联网，卫霍正式入队',
		retrievalQuery: '不要联网，卫霍正式入队',
		changed: false,
		reasons: [],
		fallbackReason: '',
	});
});

test('prepareRetrievalQuery uses an LLM-generated retrieval query without changing the original query', async () => {
	const calls = [];
	const result = await prepareRetrievalQuery({
		query: '不要联网，卫霍正式入队',
		config: { mode: 'llm_rewrite' },
		callLLM: async (messages, systemPrompt) => {
			calls.push({ messages, systemPrompt });
			return '卫霍正式入队 条件';
		},
	});

	assert.deepEqual(result, {
		mode: 'llm_rewrite',
		originalQuery: '不要联网，卫霍正式入队',
		retrievalQuery: '卫霍正式入队 条件',
		changed: true,
		reasons: [],
		fallbackReason: '',
	});
	assert.match(calls[0].systemPrompt, /retrieval query/i);
	assert.match(calls[0].messages[0].content[0].text, /不要联网，卫霍正式入队/);
});

test('prepareRetrievalQuery falls back to the original query when LLM rewriting fails', async () => {
	const result = await prepareRetrievalQuery({
		query: '卫霍正式入队',
		config: { mode: 'llm_rewrite' },
		callLLM: async () => {
			throw new Error('gateway unavailable');
		},
	});

	assert.equal(result.retrievalQuery, '卫霍正式入队');
	assert.equal(result.changed, false);
	assert.equal(result.fallbackReason, 'rewrite_failed');
});
