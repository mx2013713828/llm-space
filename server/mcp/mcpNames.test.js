import test from 'node:test';
import assert from 'node:assert/strict';

import {
	buildMcpToolName,
	normalizeMcpName,
	parseMcpToolName,
} from './mcpNames.js';

test('normalizes MCP names for tool namespace use', () => {
	assert.equal(normalizeMcpName('Context 7 Docs'), 'context_7_docs');
	assert.equal(normalizeMcpName('@upstash/context7-mcp'), 'upstash_context7-mcp');
	assert.equal(normalizeMcpName('___Already--OK___'), 'already--ok');
	assert.equal(normalizeMcpName(''), 'mcp');
});

test('builds and parses namespaced MCP tool names', () => {
	const name = buildMcpToolName('Context 7', 'resolve-library-id');
	assert.equal(name, 'mcp__context_7__resolve-library-id');
	assert.deepEqual(parseMcpToolName(name), {
		serverId: 'context_7',
		toolName: 'resolve-library-id',
	});
	assert.equal(parseMcpToolName('bash'), null);
});
