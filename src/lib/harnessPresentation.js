export function getHarnessPresentation(harness) {
	if (!harness) {
		return {
			id: '',
			name: '',
			primary: 'No harness selected',
			secondary: 'Select a harness',
			title: 'No harness selected',
		};
	}

	const id = String(harness.id || '').trim();
	const name = String(harness.name || '').trim().replace(/\.json$/i, '').trim();
	const primary = name || id || 'No harness selected';
	const secondary = id || 'Select a harness';
	return {
		id,
		name,
		primary,
		secondary,
		title: id && primary !== id ? `${primary} (${id})` : primary,
	};
}
