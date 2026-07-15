import test from 'node:test';
import assert from 'node:assert/strict';

import { getKnowledgeRetrievalPresentation } from './knowledgeRetrievalPresentation.js';

test('presents injected knowledge retrieval as a successful trace', () => {
	assert.deepEqual(getKnowledgeRetrievalPresentation({
		status: 'injected',
		resultCount: 2,
		strategy: 'hybrid',
	}), {
		label: 'Injected',
		tone: 'success',
		summary: '2 sources · hybrid retrieval',
	});
});

test('presents skipped and unavailable retrieval as observable non-success states', () => {
	assert.deepEqual(getKnowledgeRetrievalPresentation({
		status: 'skipped',
		resultCount: 1,
		strategy: 'vector',
	}), {
		label: 'Not injected',
		tone: 'warning',
		summary: '1 source · vector retrieval',
	});

	assert.deepEqual(getKnowledgeRetrievalPresentation({ status: 'unavailable' }), {
		label: 'Unavailable',
		tone: 'danger',
		summary: '0 sources · retrieval unavailable',
	});
});
