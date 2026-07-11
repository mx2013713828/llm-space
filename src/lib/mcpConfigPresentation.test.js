import test from 'node:test';
import assert from 'node:assert/strict';

import { editorRowsToMap, mapToEditorRows } from './mcpConfigPresentation.js';

test('converts persisted MCP maps into editable rows', () => {
	assert.deepEqual(mapToEditorRows({
		CONTEXT7_API_KEY: 'ctx7sk-local',
		'X-Tenant': 'demo',
	}), [
		{ key: 'CONTEXT7_API_KEY', value: 'ctx7sk-local' },
		{ key: 'X-Tenant', value: 'demo' },
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
