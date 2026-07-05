import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContextInspectorModel,
  formatContextSize,
} from './contextInspectorModel.js';

test('buildContextInspectorModel groups sent model context only', () => {
  const model = buildContextInspectorModel({
    promptAssembly: {
      sections: [
        {
          id: 'agent_guidance',
          label: 'AGENTS.md',
          target: 'system',
          lifecycle: 'pinned',
          source: 'guidance/h1/AGENTS.md',
          content: 'You are helpful.',
          chars: 16,
          sentToModel: true,
        },
        {
          id: 'memory_candidate_queue',
          label: 'Memory Candidates',
          target: 'sidecar',
          lifecycle: 'queue',
          source: '.memory/h1/_candidates',
          content: 'not sent',
          chars: 8,
          sentToModel: false,
        },
      ],
    },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ],
    tools: [
      { name: 'bash', description: 'Run shell', input_schema: { type: 'object' } },
    ],
  });

  assert.deepEqual(model.groups.map(group => group.id), ['system', 'messages', 'tools']);
  assert.deepEqual(model.groups[0].rows.map(row => row.id), ['agent_guidance']);
  assert.equal(JSON.stringify(model).includes('memory_candidate_queue'), false);
  assert.equal(model.defaultSelectionId, 'agent_guidance');
});

test('formatContextSize uses compact readable labels', () => {
  assert.equal(formatContextSize(999), '999 chars');
  assert.equal(formatContextSize(1536), '1.5k chars');
});

test('buildContextInspectorModel exposes a continuous message transcript', () => {
  const model = buildContextInspectorModel({
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'considering' },
          { type: 'text', text: 'hi there' },
        ],
      },
    ],
  });

  assert.equal(model.messageTranscript.items.length, 2);
  assert.equal(model.messageTranscript.items[0].id, 'message_0');
  assert.equal(model.messageTranscript.items[0].role, 'user');
  assert.deepEqual(model.messageTranscript.items[1].blocks.map(block => block.type), ['thinking', 'text']);
  assert.match(model.messageTranscript.content, /#1 user/);
  assert.match(model.messageTranscript.content, /#2 assistant/);
  assert.match(model.messageTranscript.content, /considering/);
});
