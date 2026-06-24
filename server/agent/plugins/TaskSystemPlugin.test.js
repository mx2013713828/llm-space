import test from 'node:test';
import assert from 'node:assert/strict';

import { TaskSystemPlugin } from './TaskSystemPlugin.js';

test('preToolUse ignores task tools already handled by earlier plugins', async () => {
  const events = [];
  const executor = {
    harnessId: 'handled-task-tool-test',
    roundsSinceTaskAction: 7,
    todos: [],
    onEvent(type, payload) {
      events.push({ type, payload });
    },
  };
  const tool = {
    toolName: 'complete_task',
    toolInput: { id: 'task_1' },
    toolOutput: '⛔ [Permission Denied]',
    handled: true,
  };
  const context = {
    executor,
    tool,
    hasUpdatedTodoThisTurn: false,
  };

  await TaskSystemPlugin.preToolUse(context);

  assert.equal(tool.toolOutput, '⛔ [Permission Denied]');
  assert.equal(tool.handled, true);
  assert.equal(executor.roundsSinceTaskAction, 7);
  assert.equal(context.hasUpdatedTodoThisTurn, false);
  assert.deepEqual(events, []);
});
