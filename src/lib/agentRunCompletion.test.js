import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentDoneEvent,
  isDifferentSessionSnapshot,
  normalizeSessionSnapshot,
} from './agentRunCompletion.js';

test('detects agent done events from the SSE stream', () => {
  assert.equal(isAgentDoneEvent({ type: 'done' }), true);
  assert.equal(isAgentDoneEvent({ type: 'text_delta' }), false);
  assert.equal(isAgentDoneEvent(null), false);
});

test('normalizes final session snapshots for UI refresh after done', () => {
  const snapshot = normalizeSessionSnapshot({
    messages: [{ role: 'assistant', content: 'complete' }],
    todos: [{ id: 'task_1' }],
  });

  assert.deepEqual(snapshot, {
    messages: [{ role: 'assistant', content: 'complete' }],
    todos: [{ id: 'task_1' }],
    backgroundTasks: [],
  });
});

test('detects changed session snapshots for active-run reconciliation', () => {
  const current = {
    messages: [{ role: 'assistant', content: 'partial' }],
    todos: [],
    backgroundTasks: [],
  };
  const incoming = {
    messages: [{ role: 'assistant', content: 'complete' }],
    todos: [],
    backgroundTasks: [],
  };

  assert.equal(isDifferentSessionSnapshot(current, incoming), true);
  assert.equal(isDifferentSessionSnapshot(current, { ...current }), false);
});
