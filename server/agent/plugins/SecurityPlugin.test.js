import test from 'node:test';
import assert from 'node:assert/strict';

import { SecurityPlugin } from './SecurityPlugin.js';

async function waitForPendingRequest(toolCallId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (SecurityPlugin.pendingRequests.has(toolCallId)) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for pending permission request ${toolCallId}`);
}

test('manual approval gate emits permission_request and permission_resolved events', async () => {
  const events = [];
  const tool = {
    id: 'toolu_security_test',
    toolName: 'write_file',
    toolInput: { path: '/tmp/outside-workspace.txt', content: 'test' },
  };
  const executor = {
    features: { security_mode: 'relaxed' },
    pendingPermission: null,
    onEvent(type, payload) {
      events.push({ type, payload });
    },
  };

  const pending = SecurityPlugin.preToolUse({ executor, tool });
  await waitForPendingRequest(tool.id);
  assert.equal(executor.pendingPermission.toolCallId, tool.id);

  assert.equal(SecurityPlugin.resolvePermission(tool.id, 'deny'), true);
  await pending;

  assert.equal(executor.pendingPermission, null);
  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /Permission Denied/);
  assert.deepEqual(events.map(event => event.type), ['permission_request', 'permission_resolved']);
  assert.equal(events[1].payload.toolCallId, tool.id);
  assert.equal(events[1].payload.decision, 'deny');
});
