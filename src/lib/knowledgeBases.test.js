import test from 'node:test';
import assert from 'node:assert/strict';

import {
	buildKnowledgeFilePayload,
	formatKnowledgeFileSize,
	getKnowledgeBaseStatusSummary,
	isSupportedKnowledgeFile,
	normalizeKnowledgeBaseSummary,
} from './knowledgeBases.js';

test('formatKnowledgeFileSize formats small UI-friendly sizes', () => {
	assert.equal(formatKnowledgeFileSize(0), '0 B');
	assert.equal(formatKnowledgeFileSize(900), '900 B');
	assert.equal(formatKnowledgeFileSize(2048), '2 KB');
	assert.equal(formatKnowledgeFileSize(1536 * 1024), '1.5 MB');
});

test('isSupportedKnowledgeFile accepts MVP document types only', () => {
	assert.equal(isSupportedKnowledgeFile('notes.md'), true);
	assert.equal(isSupportedKnowledgeFile('README.markdown'), true);
	assert.equal(isSupportedKnowledgeFile('policy.txt'), true);
	assert.equal(isSupportedKnowledgeFile('schema.json'), true);
	assert.equal(isSupportedKnowledgeFile('report.pdf'), false);
	assert.equal(isSupportedKnowledgeFile(''), false);
});

test('normalizeKnowledgeBaseSummary returns stable display defaults', () => {
	assert.deepEqual(normalizeKnowledgeBaseSummary({
		id: 'kb_docs',
		name: '',
		description: null,
		fileCount: '2',
		chunkCount: '8',
		updatedAt: '2026-06-01T00:00:00.000Z',
	}), {
		id: 'kb_docs',
		name: 'Untitled knowledge base',
		description: '',
		fileCount: 2,
		chunkCount: 8,
		updatedAt: '2026-06-01T00:00:00.000Z',
	});
});

test('getKnowledgeBaseStatusSummary favors mounted and indexed state', () => {
	assert.equal(getKnowledgeBaseStatusSummary({ fileCount: 0, chunkCount: 0 }, false), 'empty');
	assert.equal(getKnowledgeBaseStatusSummary({ fileCount: 1, chunkCount: 0 }, false), 'processing');
	assert.equal(getKnowledgeBaseStatusSummary({ fileCount: 1, chunkCount: 4 }, false), 'indexed');
	assert.equal(getKnowledgeBaseStatusSummary({ fileCount: 1, chunkCount: 4 }, true), 'mounted');
});

test('buildKnowledgeFilePayload trims settings and preserves file metadata', () => {
	assert.deepEqual(buildKnowledgeFilePayload({
		file: {
			name: 'guide.md',
			type: 'text/markdown',
			size: 1234,
		},
		content: '  hello  ',
		settings: {
			chunkSize: '1200',
			overlap: '200',
		},
	}), {
		filename: 'guide.md',
		mimeType: 'text/markdown',
		size: 1234,
		content: '  hello  ',
		settings: {
			chunkSize: 1200,
			overlap: 200,
		},
	});
});
