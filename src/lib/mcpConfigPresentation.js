export function mapToEditorRows(map = {}) {
	if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
	return Object.entries(map).map(([key, value]) => {
		if (value?.source === 'environment') {
			return { key: String(key), value: String(value.name || ''), source: 'environment' };
		}
		if (value?.source === 'bearer') {
			return { key: String(key), value: String(value.name || value.value || ''), source: 'bearer' };
		}
		return { key: String(key), value: typeof value === 'object' ? String(value.value || '') : String(value), source: 'literal' };
	});
}

export function editorRowsToMap(rows = []) {
	return Object.fromEntries((Array.isArray(rows) ? rows : [])
		.map(row => {
			const key = String(row?.key || '').trim();
			const value = String(row?.value || '').trim();
			const source = row?.source || 'literal';
			if (!key || !value) return ['', ''];
			if (source === 'environment') return [key, { source, name: value }];
			if (source === 'bearer') return [key, { source, value }];
			return [key, value];
		})
		.filter(([key, value]) => key && value));
}
