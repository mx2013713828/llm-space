import test from 'node:test';
import assert from 'node:assert/strict';

import { buildChildOutcome } from './childOutcome.js';

test('does not treat pre-tool progress text as a final child result', () => {
  const outcome = buildChildOutcome({
    messages: [
      { role: 'assistant', type: 'text', content: 'I will inspect files.' },
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
    ],
    stopReason: 'end_turn',
  });

  assert.equal(outcome.status, 'no_result');
  assert.equal(outcome.content, '');
  assert.equal(outcome.lastToolName, 'read_file');
  assert.match(outcome.error, /final text report/i);
  assert.equal(outcome.messageCount, 2);
});

test('maps legacy turn_limit stop reasons to no_result for child runtime', () => {
  const outcome = buildChildOutcome({
    messages: [{ role: 'assistant', type: 'text', content: 'Partial analysis.' }],
    stopReason: 'turn_limit',
    legacyMaxTurns: 4,
  });

  assert.equal(outcome.status, 'no_result');
  assert.equal(outcome.content, '');
  assert.match(outcome.error, /legacy turn limit/i);
  assert.equal(outcome.messageCount, 1);
});

test('accepts final text after the last child tool call', () => {
  const outcome = buildChildOutcome({
    messages: [
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
      { role: 'assistant', type: 'text', content: 'Final report.' },
    ],
    stopReason: 'end_turn',
  });

  assert.deepEqual(outcome, {
    status: 'completed',
    content: 'Final report.',
    error: null,
    lastToolName: 'read_file',
    messageCount: 2,
  });
});
