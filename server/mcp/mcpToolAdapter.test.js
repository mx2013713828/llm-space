import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptMcpTool } from './mcpToolAdapter.js';

test('adapts MCP tool schema to internal tool definition', () => {
	const tool = adaptMcpTool({
		server: { id: 'context7', name: 'Context7' },
		tool: {
			name: 'get-library-docs',
			description: 'Fetch docs',
			inputSchema: {
				type: 'object',
				properties: {
					libraryId: { type: 'string', description: 'Resolved library id' },
					tokens: { type: 'number', description: 'Token budget' },
				},
				required: ['libraryId'],
			},
			annotations: { readOnlyHint: true },
		},
	});

	assert.equal(tool.name, 'mcp__context7__get-library-docs');
	assert.equal(tool.description, '[MCP: Context7] Fetch docs');
	assert.equal(tool.mcp.serverId, 'context7');
	assert.equal(tool.mcp.toolName, 'get-library-docs');
	assert.equal(tool.parameters.libraryId.required, true);
	assert.equal(tool.parameters.tokens.required, false);
	assert.equal(tool.annotations.readOnlyHint, true);
});
