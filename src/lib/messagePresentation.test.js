import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getThinkingDisplayContent,
  getUserMessagePresentation,
  isAssistantTextFinalAnswer,
} from './messagePresentation.js';

test('classifies scheduled user messages and removes the transport prefix', () => {
  assert.deepEqual(getUserMessagePresentation({
    role: 'user',
    type: 'scheduled',
    content: '[Scheduled] check build'
  }), {
    variant: 'scheduled',
    content: 'check build'
  });
});

test('keeps normal user messages unchanged', () => {
  assert.deepEqual(getUserMessagePresentation({
    role: 'user',
    type: 'text',
    content: 'hello'
  }), {
    variant: 'user',
    content: 'hello'
  });
});

test('shows the folded marker without hiding the original thinking', () => {
  assert.equal(
    getThinkingDisplayContent('完整思考过程', true),
    '[Thinking folded]\n完整思考过程'
  );
  assert.equal(getThinkingDisplayContent('完整思考过程', false), '完整思考过程');
});

test('marks assistant text followed by tool calls as progress text', () => {
  const turnMessages = [
    { role: 'assistant', type: 'text', content: 'I will inspect files.' },
    { role: 'assistant', type: 'tool_call', toolName: 'read_file' },
  ];

  assert.equal(isAssistantTextFinalAnswer(turnMessages, 0), false);
});

test('marks the last assistant text in a turn as final answer', () => {
  const turnMessages = [
    { role: 'assistant', type: 'tool_call', toolName: 'read_file' },
    { role: 'assistant', type: 'text', content: 'Done.' },
  ];

  assert.equal(isAssistantTextFinalAnswer(turnMessages, 1), true);
});
