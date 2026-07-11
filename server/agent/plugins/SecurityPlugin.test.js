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

test('bash cannot bypass sensitive file policy through python', async () => {
  const tool = {
    id: 'toolu_python_env_read',
    toolName: 'bash',
    toolInput: { command: `python -c "print(open('.env').read())"` },
  };
  const executor = {
    features: { security_mode: 'relaxed' },
    pendingPermission: null,
    onEvent() {},
  };

  await SecurityPlugin.preToolUse({ executor, tool });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /Sensitive file access/i);
  assert.equal(SecurityPlugin.pendingRequests.has(tool.id), false);
});

test('bash cannot bypass sensitive file policy through node', async () => {
  const tool = {
    id: 'toolu_node_env_read',
    toolName: 'bash',
    toolInput: { command: `node -e "console.log(require('fs').readFileSync('.env.local', 'utf8'))"` },
  };
  const executor = {
    features: { security_mode: 'full' },
    pendingPermission: null,
    onEvent() {},
  };

  await SecurityPlugin.preToolUse({ executor, tool });

  assert.equal(tool.handled, true);
  assert.match(tool.toolOutput, /Sensitive file access/i);
  assert.equal(SecurityPlugin.pendingRequests.has(tool.id), false);
});

test('auto_readonly MCP policy lets explicitly read-only tools run without approval', async () => {
  const tool = {
    id: 'toolu_mcp_readonly',
    toolName: 'mcp__context7__resolve_library_id',
    toolInput: { libraryName: 'react' },
  };
  const executor = {
    features: { security_mode: 'relaxed' },
    mcpMount: { approvalMode: 'auto_readonly' },
    tools: [{
      name: tool.toolName,
      mcp: { serverId: 'context7', toolName: 'resolve_library_id' },
      annotations: { readOnlyHint: true },
    }],
    pendingPermission: null,
    onEvent() {},
  };

  await SecurityPlugin.preToolUse({ executor, tool });

  assert.equal(tool.handled, undefined);
  assert.equal(SecurityPlugin.pendingRequests.has(tool.id), false);
});

test('auto_readonly MCP policy asks for approval when annotations are missing', async () => {
  const tool = {
    id: 'toolu_mcp_unknown_side_effect',
    toolName: 'mcp__github__create_issue',
    toolInput: { title: 'Example' },
  };
  const events = [];
  const executor = {
    features: { security_mode: 'relaxed' },
    mcpMount: { approvalMode: 'auto_readonly' },
    tools: [{
      name: tool.toolName,
      mcp: { serverId: 'github', toolName: 'create_issue' },
      annotations: {},
    }],
    pendingPermission: null,
    onEvent(type, payload) { events.push({ type, payload }); },
  };

  const pending = SecurityPlugin.preToolUse({ executor, tool });
  await waitForPendingRequest(tool.id);
  assert.equal(events[0].type, 'permission_request');
  assert.equal(events[0].payload.mcp.policyMode, 'auto_readonly');
  assert.equal(events[0].payload.mcp.policySource, 'harness');

  SecurityPlugin.resolvePermission(tool.id, 'deny');
  await pending;
  assert.equal(tool.handled, true);
});
