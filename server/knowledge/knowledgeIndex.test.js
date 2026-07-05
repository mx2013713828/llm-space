import test from 'node:test';
import assert from 'node:assert/strict';

import { buildKeywordIndex, retrieveFromKeywordIndex, tokenizeKnowledgeText } from './knowledgeIndex.js';

test('tokenizeKnowledgeText supports mixed Chinese and English terms', () => {
  assert.deepEqual(tokenizeKnowledgeText('DeepSeek 模型 context-window'), [
    'deepseek',
    '模型',
    'context',
    'window',
  ]);
});

test('retrieveFromKeywordIndex ranks matching chunks and respects limits', () => {
  const chunks = [
    { id: 'a', text: 'alpha weather linyi forecast', source: { filename: 'a.md' } },
    { id: 'b', text: 'beta unrelated content', source: { filename: 'b.md' } },
    { id: 'c', text: 'linyi humidity weather weather', source: { filename: 'c.md' } },
  ];
  const index = buildKeywordIndex(chunks);

  const results = retrieveFromKeywordIndex({
    query: 'linyi weather',
    chunks,
    index,
    topK: 2,
    maxChars: 200,
  });

  assert.deepEqual(results.map(item => item.id), ['c', 'a']);
  assert.equal(results[0].score > results[1].score, true);
  assert.equal(results.every(item => item.source.filename), true);
});
