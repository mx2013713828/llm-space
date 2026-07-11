import test from 'node:test';
import assert from 'node:assert/strict';

import { formatMcpAuthStatus, formatMcpCallSummary, formatMcpStatus } from './mcpRuntimePresentation.js';

test('formats MCP lifecycle and authentication evidence', () => {
	assert.deepEqual(formatMcpStatus({ status: 'stopped' }), { value: 'stopped', label: 'Stopped', tone: 'stopped' });
	assert.deepEqual(formatMcpAuthStatus({ status: 'verified' }), { value: 'verified', label: 'Verified', tone: 'verified' });
});

test('formats compact redacted MCP call summaries', () => {
	assert.deepEqual(formatMcpCallSummary({ id: 'call_1', toolName: 'echo', status: 'success', durationMs: 8, argumentKeys: ['text'] }), {
		id: 'call_1', label: 'echo', meta: 'success · 8ms · 1 argument key(s)', error: '',
	});
});
