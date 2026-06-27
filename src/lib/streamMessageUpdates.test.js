import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyStreamMessageEvent,
  createStreamMessageState,
} from './streamMessageUpdates.js';

test('routes text deltas to the active stream block instead of the previous text block', () => {
  const messages = [
    {
      id: 'old_text',
      role: 'assistant',
      type: 'text',
      turn: 1,
      content: 'Preliminary note.',
    },
    {
      id: 'tool_1',
      role: 'assistant',
      type: 'tool_call',
      turn: 1,
      toolName: 'wait_for_teammates',
      toolOutput: 'done',
    },
  ];
  const state = createStreamMessageState();

  const afterStart = applyStreamMessageEvent(messages, state, {
    type: 'text_start',
    id: 'final_text',
    turn: 1,
  });
  const afterDelta = applyStreamMessageEvent(afterStart.messages, afterStart.state, {
    type: 'text_delta',
    id: 'final_text',
    text: 'Final summary.',
  });

  assert.equal(afterDelta.messages[0].content, 'Preliminary note.');
  assert.equal(afterDelta.messages[2].id, 'final_text');
  assert.equal(afterDelta.messages[2].content, 'Final summary.');
});

test('keeps thinking deltas attached to their stream block after messages_update restores a snapshot', () => {
  const state = createStreamMessageState();
  const afterStart = applyStreamMessageEvent([], state, {
    type: 'thinking_start',
    id: 'thinking_1',
    turn: 1,
  });
  const snapshot = [
    {
      id: 'thinking_1',
      role: 'assistant',
      type: 'thinking',
      turn: 1,
      content: 'Plan',
    },
    {
      id: 'tool_1',
      role: 'assistant',
      type: 'tool_call',
      turn: 1,
      toolName: 'bash',
    },
  ];

  const afterDelta = applyStreamMessageEvent(snapshot, afterStart.state, {
    type: 'thinking_delta',
    id: 'thinking_1',
    text: ' more',
  });

  assert.equal(afterDelta.messages[0].content, 'Plan more');
  assert.equal(afterDelta.messages[1].type, 'tool_call');
});
