import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveInteractionMode } from './interactionMode.js';

test('uses no tools for questions about previous tool calls', () => {
  const result = resolveInteractionMode({
    messages: [{ role: 'user', content: '你刚才为什么要调用 read_file？' }],
  });

  assert.equal(result.mode, 'trace_inspection');
  assert.equal(result.toolPolicy, 'none');
  assert.match(result.reason, /previous tool/i);
});

test('uses normal tools for explicit new work', () => {
  const result = resolveInteractionMode({
    messages: [{ role: 'user', content: '读取 server.js 并解释 836 行附近的逻辑' }],
  });

  assert.equal(result.mode, 'normal');
  assert.equal(result.toolPolicy, 'normal');
});

test('respects explicit requested mode from the API payload', () => {
  const result = resolveInteractionMode({
    requestedMode: 'trace_inspection',
    messages: [{ role: 'user', content: '这次普通问题也不要调用工具' }],
  });

  assert.equal(result.mode, 'trace_inspection');
  assert.equal(result.toolPolicy, 'none');
});
