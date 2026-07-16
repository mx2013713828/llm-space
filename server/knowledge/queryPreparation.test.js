import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareRetrievalQuery } from './queryPreparation.js';

test('prepareRetrievalQuery keeps the full user query in raw mode', () => {
	assert.deepEqual(prepareRetrievalQuery({
		query: '不要联网，卫霍正式入队',
		config: { mode: 'raw' },
	}), {
		mode: 'raw',
		originalQuery: '不要联网，卫霍正式入队',
		retrievalQuery: '不要联网，卫霍正式入队',
		changed: false,
		reasons: [],
	});
});

test('prepareRetrievalQuery removes only leading retrieval-control language in rule cleanup mode', () => {
	assert.deepEqual(prepareRetrievalQuery({
		query: '不要联网，卫霍正式入队',
		config: { mode: 'rule_cleanup' },
	}), {
		mode: 'rule_cleanup',
		originalQuery: '不要联网，卫霍正式入队',
		retrievalQuery: '卫霍正式入队',
		changed: true,
		reasons: ['removed_network_constraint'],
	});
});

test('prepareRetrievalQuery never replaces an empty cleaned query with an empty retrieval query', () => {
	const result = prepareRetrievalQuery({
		query: '不要联网',
		config: { mode: 'rule_cleanup' },
	});

	assert.equal(result.retrievalQuery, '不要联网');
	assert.equal(result.changed, false);
	assert.deepEqual(result.reasons, ['cleanup_would_empty_query']);
});
