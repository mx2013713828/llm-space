import test from 'node:test';
import assert from 'node:assert/strict';

import { McpRuntimeLog } from './mcpRuntimeLog.js';

test('stores bounded MCP call summaries without raw arguments', () => {
	const log = new McpRuntimeLog({ limitPerServer: 2, previewLimit: 12 });
	const first = log.record({
		serverId: 'echo', toolName: 'echo', argumentKeys: ['text'], output: 'hello from a very long response', durationMs: 8,
	});
	log.record({ serverId: 'echo', toolName: 'echo', argumentKeys: ['text'], output: 'two' });
	log.record({ serverId: 'echo', toolName: 'echo', argumentKeys: ['text'], output: 'three' });

	assert.equal(log.list('echo').length, 2);
	assert.equal(log.get('echo', first.id), null);
	const detail = log.get('echo', log.list('echo')[0].id);
	assert.deepEqual(detail.argumentKeys, ['text']);
	assert.equal(detail.outputPreview.length <= 12, true);
	assert.equal(Object.hasOwn(detail, 'arguments'), false);
});
