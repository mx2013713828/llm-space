import test from 'node:test';
import assert from 'node:assert/strict';

import { createKnowledgeChunks, normalizeChunkSettings } from './knowledgeChunking.js';

test('normalizeChunkSettings clamps unsafe chunk sizes and overlap', () => {
	assert.deepEqual(normalizeChunkSettings({ chunkSize: 20, overlap: 100 }), {
		chunkSize: 200,
		overlap: 100,
	});
  assert.deepEqual(normalizeChunkSettings({ chunkSize: 5000, overlap: 9999 }), {
    chunkSize: 4000,
    overlap: 1000,
  });
});

test('createKnowledgeChunks creates deterministic bounded chunks with source metadata', () => {
	const parsed = {
		text: 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda '.repeat(12),
		metadata: { filename: 'notes.md', mimeType: 'text/markdown' },
	};

  const chunks = createKnowledgeChunks({
    knowledgeBaseId: 'kb_docs',
    fileId: 'file_abc',
    parsedDocument: parsed,
		settings: { chunkSize: 200, overlap: 20 },
	});

  assert.equal(chunks.length > 1, true);
  assert.equal(chunks[0].id, 'chk_file_abc_0000');
  assert.equal(chunks[0].knowledgeBaseId, 'kb_docs');
  assert.equal(chunks[0].fileId, 'file_abc');
  assert.equal(chunks[0].source.filename, 'notes.md');
  assert.equal(chunks[0].text.length <= 200, true);
  assert.equal(chunks[1].start < chunks[1].end, true);
});
