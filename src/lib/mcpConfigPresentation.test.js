import test from 'node:test';
import assert from 'node:assert/strict';

import { editorRowsToMap, mapToEditorRows } from './mcpConfigPresentation.js';

test('converts persisted MCP maps into editable rows', () => {
	assert.deepEqual(mapToEditorRows({
		CONTEXT7_API_KEY: 'ctx7sk-local',
		'X-Tenant': 'demo',
	}), [
		{ key: 'CONTEXT7_API_KEY', value: 'ctx7sk-local', source: 'literal' },
		{ key: 'X-Tenant', value: 'demo', source: 'literal' },
	]);
});

test('omits blank MCP editor rows when saving', () => {
	assert.deepEqual(editorRowsToMap([
		{ key: 'Authorization', value: 'Bearer local-token' },
		{ key: ' ', value: 'ignored' },
		{ key: 'Empty value', value: ' ' },
	]), {
		Authorization: 'Bearer local-token',
	});
});

test('preserves an environment-reference source in MCP editor rows', () => {
	assert.deepEqual(mapToEditorRows({
		SERVICE_TOKEN: { source: 'environment', name: 'SERVICE_TOKEN' },
	}), [{ key: 'SERVICE_TOKEN', value: 'SERVICE_TOKEN', source: 'environment' }]);
	assert.deepEqual(editorRowsToMap([
		{ key: 'SERVICE_TOKEN', value: 'SERVICE_TOKEN', source: 'environment' },
	]), {
		SERVICE_TOKEN: { source: 'environment', name: 'SERVICE_TOKEN' },
	});
});
