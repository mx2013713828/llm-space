import test from 'node:test';
import assert from 'node:assert/strict';

import {
	buildKnowledgeFilePayload,
	formatKnowledgeFileSize,
	getKnowledgeBaseStatusSummary,
	isSupportedKnowledgeFile,
	normalizeKnowledgeBaseSummary,
	normalizeRetrievalSettings,
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
	assert.equal(isSupportedKnowledgeFile('table.csv'), true);
	assert.equal(isSupportedKnowledgeFile('report.pdf'), true);
	assert.equal(isSupportedKnowledgeFile('notes.docx'), true);
	assert.equal(isSupportedKnowledgeFile('book.epub'), false);
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
		settings: {
			chunkSize: 1000,
			overlap: 150,
			topK: 5,
			maxChars: 8000,
			scoreThreshold: 0,
			indexMethod: 'keyword',
			retrievalStrategy: 'keyword',
			embeddingProvider: 'none',
			embeddingModel: '',
		},
		updatedAt: '2026-06-01T00:00:00.000Z',
	});
});

test('normalizeRetrievalSettings returns stable retrieval quality defaults', () => {
	assert.deepEqual(normalizeRetrievalSettings({
		topK: '3',
		maxChars: '1600',
		scoreThreshold: '0.5',
		indexMethod: 'keyword',
		retrievalStrategy: 'keyword',
	}), {
		chunkSize: 1000,
		overlap: 150,
		topK: 3,
		maxChars: 1600,
		scoreThreshold: 0.5,
		indexMethod: 'keyword',
		retrievalStrategy: 'keyword',
		embeddingProvider: 'none',
		embeddingModel: '',
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
		contentBase64: 'ICBoZWxsbyAg',
		settings: {
			chunkSize: '1200',
			overlap: '200',
		},
	}), {
		filename: 'guide.md',
		mimeType: 'text/markdown',
		size: 1234,
		content: '  hello  ',
		contentBase64: 'ICBoZWxsbyAg',
		settings: {
			chunkSize: 1200,
			overlap: 200,
			embeddingProvider: 'none',
			indexMethod: 'keyword',
			retrievalStrategy: 'keyword',
		},
	});
});
