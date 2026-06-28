import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRunEvent,
  applySessionSnapshotToRunState,
  createRunViewModelState,
} from './runViewModel.js';

test('active stream text is not overwritten by a stale messages_update snapshot', () => {
  let state = createRunViewModelState({ messages: [] });
  state = applyRunEvent(state, { type: 'text_start', id: 'txt_1', turn: 1 });
  state = applyRunEvent(state, { type: 'text_delta', id: 'txt_1', text: 'live text' });

  state = applySessionSnapshotToRunState(state, {
    messages: [{ id: 'txt_1', role: 'assistant', type: 'text', content: 'old' }],
  }, { phase: 'active' });

  assert.equal(state.messages[0].content, 'live text');
  assert.equal(state.messages[0].streaming, true);
});

test('done snapshot replaces active stream state', () => {
  let state = createRunViewModelState({ messages: [] });
  state = applyRunEvent(state, { type: 'text_start', id: 'txt_1', turn: 1 });
  state = applyRunEvent(state, { type: 'text_delta', id: 'txt_1', text: 'live text' });

  state = applySessionSnapshotToRunState(state, {
    messages: [{ id: 'txt_1', role: 'assistant', type: 'text', content: 'persisted final' }],
  }, { phase: 'done' });

  assert.equal(state.messages[0].content, 'persisted final');
  assert.equal(state.messages[0].streaming, undefined);
  assert.equal(state.activeMessageIds.size, 0);
});

test('active snapshots can add inactive tool results without removing live text', () => {
  let state = createRunViewModelState({ messages: [] });
  state = applyRunEvent(state, { type: 'text_start', id: 'txt_1', turn: 1 });
  state = applyRunEvent(state, { type: 'text_delta', id: 'txt_1', text: 'live text' });

  state = applySessionSnapshotToRunState(state, {
    messages: [
      { id: 'txt_1', role: 'assistant', type: 'text', content: 'old' },
      { id: 'tool_1', role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'done' },
    ],
  }, { phase: 'active' });

  assert.equal(state.messages[0].content, 'live text');
  assert.equal(state.messages[1].toolOutput, 'done');
});
