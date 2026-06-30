import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTeammateOutcome } from './teammateOutcome.js';

test('does not treat a pre-tool progress text as final result', () => {
  const outcome = buildTeammateOutcome({
    messages: [
      { role: 'assistant', type: 'text', content: 'I will inspect files.' },
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
    ],
    stopReason: 'end_turn',
  });

  assert.equal(outcome.status, 'no_result');
  assert.equal(outcome.content, '');
  assert.match(outcome.error, /final text report/i);
  assert.equal(outcome.lastToolName, 'read_file');
  assert.equal(outcome.messageCount, 2);
});

test('accepts final text after the last tool call', () => {
  const outcome = buildTeammateOutcome({
    messages: [
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
      { role: 'assistant', type: 'text', content: 'Final report.' },
    ],
    stopReason: 'end_turn',
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.content, 'Final report.');
  assert.equal(outcome.error, null);
});
