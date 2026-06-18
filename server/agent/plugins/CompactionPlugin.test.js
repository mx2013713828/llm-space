import test from 'node:test';
import assert from 'node:assert/strict';
import { foldThinkingForDisplay } from './CompactionPlugin.js';

test('marks completed thinking as folded without deleting its content', () => {
  const messages = [
    { role: 'assistant', type: 'thinking', turn: 1, content: 'normal conversation reasoning' },
    { role: 'assistant', type: 'text', turn: 1, content: 'answer' }
  ];
  const events = [];
  const executor = {
    messages,
    features: { context_compaction: { enabled: true, thinking_compaction: true } },
    onEvent: (type) => events.push(type)
  };

  assert.equal(foldThinkingForDisplay(executor), true);
  assert.equal(messages[0].folded, true);
  assert.equal(messages[0].content, 'normal conversation reasoning');
  assert.deepEqual(events, ['messages_update']);
});

test('does not mark thinking when thinking compaction is disabled', () => {
  const messages = [{ role: 'assistant', type: 'thinking', content: 'keep visible' }];
  const executor = {
    messages,
    features: { context_compaction: { enabled: true, thinking_compaction: false } },
    onEvent() {}
  };

  assert.equal(foldThinkingForDisplay(executor), false);
  assert.equal(messages[0].folded, undefined);
});
