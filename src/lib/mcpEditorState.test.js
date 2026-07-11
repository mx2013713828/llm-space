import test from 'node:test';
import assert from 'node:assert/strict';

import {
	closeMcpEditor,
	createMcpEditorState,
	isMcpEditorOpen,
	openMcpCreate,
	openMcpEdit,
} from './mcpEditorState.js';

test('opens create and edit modes while remembering the selected server', () => {
	const base = createMcpEditorState();
	assert.deepEqual(openMcpCreate(base, 'echo'), { mode: 'create', returnServerId: 'echo' });
	assert.deepEqual(openMcpEdit(base, 'context7'), { mode: 'edit', returnServerId: 'context7' });
});

test('closing the editor returns to detail mode without losing return selection', () => {
	const open = openMcpEdit(createMcpEditorState(), 'echo');
	assert.deepEqual(closeMcpEditor(open), { mode: 'detail', returnServerId: 'echo' });
	assert.equal(isMcpEditorOpen(open), true);
	assert.equal(isMcpEditorOpen(closeMcpEditor(open)), false);
});
