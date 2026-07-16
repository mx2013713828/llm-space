export const QUERY_PREPARATION_MODES = Object.freeze(['raw', 'rule_cleanup']);

const SUPPORTED_QUERY_PREPARATION_MODES = new Set(QUERY_PREPARATION_MODES);

export function normalizeQueryPreparation(config = {}) {
	const input = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
	const mode = String(input.mode || 'raw').trim();
	return {
		mode: SUPPORTED_QUERY_PREPARATION_MODES.has(mode) ? mode : 'raw',
	};
}

export function prepareRetrievalQuery({ query = '', config = {} } = {}) {
	const originalQuery = String(query || '').trim();
	const { mode } = normalizeQueryPreparation(config);
	if (!originalQuery || mode === 'raw') {
		return {
			mode,
			originalQuery,
			retrievalQuery: originalQuery,
			changed: false,
			reasons: [],
		};
	}

	const { query: cleanedQuery, reasons } = cleanupRetrievalControlLanguage(originalQuery);
	if (!cleanedQuery) {
		return {
			mode,
			originalQuery,
			retrievalQuery: originalQuery,
			changed: false,
			reasons: ['cleanup_would_empty_query'],
		};
	}

	return {
		mode,
		originalQuery,
		retrievalQuery: cleanedQuery,
		changed: cleanedQuery !== originalQuery,
		reasons,
	};
}

function cleanupRetrievalControlLanguage(query) {
	let next = query;
	const reasons = [];
	const patterns = [
		{
			pattern: /^\s*(?:请|麻烦|帮我|请你)?\s*(?:不要|不需|无需)\s*(?:联网|上网|访问(?:互联网|网络)|使用(?:互联网|网络|web|浏览器)|搜索(?:网络|网页)?|调用(?:网络|搜索)?)(?:\s*[，,。;；、:：-])?\s*/i,
			reason: 'removed_network_constraint',
		},
		{
			pattern: /^\s*(?:请|麻烦|帮我|请你)?\s*(?:仅|只)\s*(?:根据|使用)\s*(?:知识库|本地资料|已挂载知识库)(?:\s*[，,。;；、:：-])?\s*/i,
			reason: 'removed_knowledge_scope_constraint',
		},
	];

	for (const { pattern, reason } of patterns) {
		const candidate = next.replace(pattern, '').trim();
		if (candidate !== next) {
			next = candidate;
			reasons.push(reason);
		}
	}

	return { query: next, reasons };
}
