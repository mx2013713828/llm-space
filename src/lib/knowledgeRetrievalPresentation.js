export function getKnowledgeRetrievalPresentation({ status = '', resultCount = 0, strategy = '' } = {}) {
	const count = Math.max(0, Number(resultCount) || 0);
	const sourceLabel = `${count} ${count === 1 ? 'source' : 'sources'}`;

	if (status === 'injected') {
		return {
			label: 'Injected',
			tone: 'success',
			summary: `${sourceLabel} · ${strategy || 'knowledge'} retrieval`,
		};
	}
	if (status === 'skipped') {
		return {
			label: 'Not injected',
			tone: 'warning',
			summary: `${sourceLabel} · ${strategy || 'knowledge'} retrieval`,
		};
	}
	return {
		label: 'Unavailable',
		tone: 'danger',
		summary: `${sourceLabel} · retrieval unavailable`,
	};
}
