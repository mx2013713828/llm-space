import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isAgentDoneEvent,
  normalizeSessionSnapshot,
  shouldApplyActiveSessionSnapshot,
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

test('does not apply stale active-run snapshots over live streamed text', () => {
  const current = {
    messages: [{ role: 'assistant', type: 'text', content: 'streamed content is ahead' }],
    todos: [],
    backgroundTasks: [],
  };
  const incoming = {
    messages: [{ role: 'assistant', type: 'text', content: 'streamed' }],
    todos: [],
    backgroundTasks: [],
  };

  assert.equal(
    shouldApplyActiveSessionSnapshot(current, incoming, { now: 10000, lastStreamAt: 0 }),
    false,
  );
});

test('does not reconcile active sessions while SSE events are still arriving', () => {
  const current = {
    messages: [{ role: 'assistant', type: 'text', content: 'partial' }],
    todos: [],
    backgroundTasks: [],
  };
  const incoming = {
    messages: [
      { role: 'assistant', type: 'text', content: 'partial' },
      { role: 'assistant', type: 'tool_call', toolName: 'read_file' },
    ],
    todos: [],
    backgroundTasks: [],
  };

  assert.equal(
    shouldApplyActiveSessionSnapshot(current, incoming, { now: 10000, lastStreamAt: 9000 }),
    false,
  );
});

test('applies active-run snapshots that advance after stream idle', () => {
  const current = {
    messages: [{ role: 'assistant', type: 'text', content: 'partial' }],
    todos: [],
    backgroundTasks: [],
  };
  const incoming = {
    messages: [
      { role: 'assistant', type: 'text', content: 'partial' },
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'done' },
    ],
    todos: [],
    backgroundTasks: [],
  };

  assert.equal(
    shouldApplyActiveSessionSnapshot(current, incoming, { now: 10000, lastStreamAt: 0 }),
    true,
  );
});
