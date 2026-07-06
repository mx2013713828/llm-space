import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
	loadKnowledgeDocument,
	resolveDocumentLoader,
	sanitizeFilename,
} from './documentLoaders.js';

test('loadKnowledgeDocument loads markdown and text with safe metadata', async () => {
	const loaded = await loadKnowledgeDocument({
		filename: '../Design Notes.md',
		mimeType: 'text/markdown',
		content: '# Title\n\nBody text',
	});

	assert.equal(loaded.text, '# Title\n\nBody text');
	assert.equal(loaded.metadata.filename, 'Design Notes.md');
	assert.equal(loaded.metadata.extension, '.md');
	assert.equal(loaded.metadata.loader, 'markdown');
	assert.equal(loaded.metadata.parser, 'markdown');
});

test('loadKnowledgeDocument turns JSON into searchable pretty text', async () => {
	const loaded = await loadKnowledgeDocument({
		filename: 'config.json',
		mimeType: 'application/json',
		content: '{"model":"deepseek","contextWindow":1000000}',
	});

	assert.match(loaded.text, /"model": "deepseek"/);
	assert.match(loaded.text, /"contextWindow": 1000000/);
	assert.equal(loaded.metadata.loader, 'json');
});

test('loadKnowledgeDocument converts CSV rows into labeled searchable text', async () => {
	const loaded = await loadKnowledgeDocument({
		filename: 'models.csv',
		mimeType: 'text/csv',
		content: 'name,context\n"deepseek-v4",1000000\nkimi,128000',
	});

	assert.match(loaded.text, /Columns: name, context/);
	assert.match(loaded.text, /name: deepseek-v4/);
	assert.match(loaded.text, /context: 1000000/);
	assert.equal(loaded.metadata.loader, 'csv');
	assert.equal(loaded.metadata.rowCount, 2);
	assert.equal(loaded.metadata.columnCount, 2);
});

test('resolveDocumentLoader supports explicit loader selection and validation', () => {
	assert.equal(resolveDocumentLoader({ extension: '.txt', loaderConfig: { loader: 'csv' } }), 'csv');
	assert.equal(resolveDocumentLoader({ extension: '.txt', loaderConfig: { parser: 'text' } }), 'text');
	assert.throws(
		() => resolveDocumentLoader({ extension: '.txt', loaderConfig: { loader: 'epub' } }),
		/Unsupported knowledge document loader/,
	);
});

test('loadKnowledgeDocument extracts DOCX text from base64 content', async () => {
	const buffer = await readFile('node_modules/mammoth/test/test-data/single-paragraph.docx');
	const loaded = await loadKnowledgeDocument({
		filename: 'single-paragraph.docx',
		mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		contentBase64: buffer.toString('base64'),
	});

	assert.match(loaded.text, /Walking on imported air/);
	assert.equal(loaded.metadata.loader, 'docx');
	assert.equal(loaded.metadata.byteLength, buffer.length);
});

test('loadKnowledgeDocument rejects unsupported formats, invalid JSON, and invalid PDF', async () => {
	assert.rejects(
		() => loadKnowledgeDocument({ filename: 'report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', content: 'x' }),
		/Unsupported knowledge file type/,
	);
	assert.rejects(
		() => loadKnowledgeDocument({ filename: 'broken.json', mimeType: 'application/json', content: '{"x"' }),
		/Invalid JSON knowledge file/,
	);
	assert.rejects(
		() => loadKnowledgeDocument({ filename: 'broken.pdf', mimeType: 'application/pdf', content: 'not a pdf' }),
		/Failed to extract PDF text/,
	);
});

test('sanitizeFilename strips path traversal and line breaks', () => {
	assert.equal(sanitizeFilename('../a\r\nb.csv'), 'a  b.csv');
});
