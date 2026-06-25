import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactionPlugin, foldThinkingForDisplay } from './CompactionPlugin.js';

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

test('soft compact refreshes apiMessages for the current loop', async () => {
  const messages = [
    {
      role: 'assistant',
      type: 'tool_call',
      turn: 1,
      id: 'tool_1',
      toolName: 'read_file',
      toolInput: { path: 'large.txt' },
      toolOutput: 'very large file content',
    },
    { role: 'user', type: 'text', turn: 8, content: 'continue' },
  ];
  const context = {
    executor: {
      messages,
      features: {
        context_compaction: { enabled: true, soft_compact: true, hard_compact: false },
        soft_compact_min_saving: 0,
      },
      compactionEnabled: true,
      compactionThresholds: { soft: 100, hard: 10000 },
      contextTokens: 200,
      systemPrompt: '',
      tools: [],
      thinkingEnabled: false,
      estimateCurrentTokens: () => 200,
      onEvent() {},
      async saveSession() {},
    },
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'stale api messages' }] }],
    turnIndex: 8,
  };

  await CompactionPlugin.preLLM(context);

  const serialized = JSON.stringify(context.apiMessages);
  assert.equal(serialized.includes('stale api messages'), false);
  assert.equal(serialized.includes('[Archived: Content is on disk, re-read if necessary]'), true);
});
