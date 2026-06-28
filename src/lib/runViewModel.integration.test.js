import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyRunEvent,
  applySessionSnapshotToRunState,
  createRunViewModelState,
} from './runViewModel.js';

test('replays live text, tool, stale snapshot, and final snapshot without phantom overwrite', () => {
  let state = createRunViewModelState({
    messages: [{ role: 'user', turn: 1, content: '检查任务编排。' }],
  });

  state = applyRunEvent(state, { type: 'text_start', id: 'lead_progress', turn: 1 });
  state = applyRunEvent(state, { type: 'text_delta', id: 'lead_progress', text: '我先启动 teammate。' });
  state = applyRunEvent(state, { type: 'tool_start', id: 'tool_spawn', name: 'spawn_teammate', turn: 1 });
  state = applyRunEvent(state, {
    type: 'tool_exec_done',
    id: 'tool_spawn',
    output: '{"teamId":"team_1","teammateId":"frontend","status":"running"}',
    status: 'completed',
  });

  state = applySessionSnapshotToRunState(state, {
    messages: [
      { role: 'user', turn: 1, content: '检查任务编排。' },
      { id: 'lead_progress', role: 'assistant', type: 'text', turn: 1, content: '旧快照' },
    ],
  }, { phase: 'active' });

  assert.equal(state.messages.find(message => message.id === 'lead_progress').content, '我先启动 teammate。');
  assert.equal(state.messages.find(message => message.id === 'tool_spawn').toolStatus, 'completed');

  state = applySessionSnapshotToRunState(state, {
    messages: [
      { role: 'user', turn: 1, content: '检查任务编排。' },
      { id: 'lead_progress', role: 'assistant', type: 'text', turn: 1, content: '我先启动 teammate。' },
      {
        id: 'tool_spawn',
        role: 'assistant',
        type: 'tool_call',
        turn: 1,
        toolName: 'spawn_teammate',
        toolOutput: '{"teamId":"team_1","teammateId":"frontend","status":"running"}',
        toolStatus: 'completed',
      },
      { id: 'final_text', role: 'assistant', type: 'text', turn: 1, content: '综合结论。' },
    ],
  }, { phase: 'done' });

  assert.deepEqual(state.messages.map(message => message.content || message.toolName), [
    '检查任务编排。',
    '我先启动 teammate。',
    'spawn_teammate',
    '综合结论。',
  ]);
  assert.equal(state.activeMessageIds.size, 0);
});
