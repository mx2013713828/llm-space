import test from 'node:test';
import assert from 'node:assert/strict';

import { buildApiMessages } from './messageBuilder.js';

test('preserves thinking content when thinking compaction child toggle is disabled', () => {
  const messages = [
    { role: 'user', type: 'text', turn: 1, content: 'hello' },
    { role: 'assistant', type: 'thinking', turn: 1, content: 'full reasoning' },
    { role: 'assistant', type: 'text', turn: 1, content: 'hi' },
  ];

  const apiMessages = buildApiMessages(messages, true, {
    enabled: true,
    thinking_compaction: false,
  });

  assert.equal(apiMessages[1].content[0].thinking, 'full reasoning');
});

test('folds thinking content when thinking compaction child toggle is enabled', () => {
  const messages = [
    { role: 'user', type: 'text', turn: 1, content: 'hello' },
    { role: 'assistant', type: 'thinking', turn: 1, content: 'full reasoning' },
    { role: 'assistant', type: 'text', turn: 1, content: 'hi' },
  ];

  const apiMessages = buildApiMessages(messages, true, {
    enabled: true,
    thinking_compaction: true,
  });

  assert.equal(apiMessages[1].content[0].thinking, '[Thinking folded]');
});
