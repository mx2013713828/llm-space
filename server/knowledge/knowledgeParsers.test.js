import test from 'node:test';
import assert from 'node:assert/strict';

import { parseKnowledgeFile } from './knowledgeParsers.js';

test('parseKnowledgeFile extracts markdown and text content with safe metadata', () => {
  const parsed = parseKnowledgeFile({
    filename: '../Design Notes.md',
    mimeType: 'text/markdown',
    content: '# Title\n\nBody text',
  });

  assert.equal(parsed.text, '# Title\n\nBody text');
  assert.equal(parsed.metadata.filename, 'Design Notes.md');
  assert.equal(parsed.metadata.extension, '.md');
  assert.equal(parsed.metadata.parser, 'markdown');
});

test('parseKnowledgeFile turns JSON into searchable pretty text', () => {
  const parsed = parseKnowledgeFile({
    filename: 'config.json',
    mimeType: 'application/json',
    content: '{"model":"deepseek","contextWindow":1000000}',
  });

  assert.match(parsed.text, /"model": "deepseek"/);
  assert.match(parsed.text, /"contextWindow": 1000000/);
  assert.equal(parsed.metadata.parser, 'json');
});

test('parseKnowledgeFile rejects unsupported formats and invalid JSON', () => {
  assert.throws(
    () => parseKnowledgeFile({ filename: 'report.pdf', mimeType: 'application/pdf', content: 'x' }),
    /Unsupported knowledge file type/,
  );
  assert.throws(
    () => parseKnowledgeFile({ filename: 'broken.json', mimeType: 'application/json', content: '{"x"' }),
    /Invalid JSON knowledge file/,
  );
});
