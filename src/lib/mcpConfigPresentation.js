export function mapToEditorRows(map = {}) {
	if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
	return Object.entries(map).map(([key, value]) => ({
		key: String(key),
		value: String(value),
	}));
}

export function editorRowsToMap(rows = []) {
	return Object.fromEntries((Array.isArray(rows) ? rows : [])
		.map(row => [String(row?.key || '').trim(), String(row?.value || '').trim()])
		.filter(([key, value]) => key && value));
}
