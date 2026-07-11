export function createMcpEditorState() {
	return { mode: 'detail', returnServerId: '' };
}

export function openMcpCreate(_state, selectedId = '') {
	return { mode: 'create', returnServerId: String(selectedId || '') };
}

export function openMcpEdit(_state, selectedId = '') {
	return { mode: 'edit', returnServerId: String(selectedId || '') };
}

export function closeMcpEditor(state = createMcpEditorState()) {
	return { mode: 'detail', returnServerId: String(state.returnServerId || '') };
}

export function isMcpEditorOpen(state) {
	return state?.mode === 'create' || state?.mode === 'edit';
}
