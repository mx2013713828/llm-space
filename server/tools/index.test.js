import test from 'node:test';
import assert from 'node:assert/strict';

import { getToolSchemasForTools } from './index.js';

test('builds schemas for dynamic MCP tool objects beside builtin tools', () => {
	const schemas = getToolSchemasForTools([
		'bash',
		{
			name: 'mcp__echo__echo',
			description: '[MCP: Echo] Echo text',
			parameters: {
				text: { type: 'string', description: 'Text to echo', required: true },
			},
		},
	]);

	assert.ok(schemas.find(schema => schema.name === 'bash'));
	const mcpSchema = schemas.find(schema => schema.name === 'mcp__echo__echo');
	assert.equal(mcpSchema.description, '[MCP: Echo] Echo text');
	assert.deepEqual(mcpSchema.input_schema.required, ['text']);
	assert.equal(mcpSchema.input_schema.properties.text.description, 'Text to echo');
});
