export function tokenizeKnowledgeText(value) {
	const text = String(value || '').toLowerCase();
	const tokens = [];
	const combined = /[a-z0-9]+|[\p{Script=Han}]+/giu;
	for (const match of text.matchAll(combined)) {
		tokens.push(match[0].toLowerCase());
	}
	return tokens;
}

export function buildKeywordIndex(chunks = []) {
	const terms = {};
	const chunkLengths = {};
	for (const chunk of chunks || []) {
		const tokens = tokenizeKnowledgeText(chunk?.text || '');
		chunkLengths[chunk.id] = tokens.length;
		for (const token of tokens) {
			terms[token] = terms[token] || {};
			terms[token][chunk.id] = (terms[token][chunk.id] || 0) + 1;
		}
	}
	return {
		schema: 'llm-space.knowledge_index.keyword.v1',
		terms,
		chunkLengths,
		documentCount: chunks.length,
	};
}

export function retrieveFromKeywordIndex({
	query,
	chunks = [],
	index,
	topK = 5,
	maxChars = 8000,
	scoreThreshold = 0,
} = {}) {
	const queryTokens = [...new Set(tokenizeKnowledgeText(query))];
	if (queryTokens.length === 0) return [];

	const byId = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
	const scores = new Map();
	const documentCount = Math.max(1, Number(index?.documentCount || chunks.length || 1));
	for (const token of queryTokens) {
		const posting = index?.terms?.[token] || {};
		const df = Object.keys(posting).length || 1;
		const idf = Math.log(1 + (documentCount / df));
		for (const [chunkId, tf] of Object.entries(posting)) {
			const length = Math.max(1, Number(index?.chunkLengths?.[chunkId] || 1));
			const normalizedTf = Number(tf) / Math.sqrt(length);
			scores.set(chunkId, (scores.get(chunkId) || 0) + normalizedTf * idf);
		}
	}

	let usedChars = 0;
	const results = [...scores.entries()]
		.map(([id, score]) => ({ ...(byId.get(id) || {}), score }))
		.filter(chunk => chunk.id && chunk.score >= Number(scoreThreshold || 0))
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

	const bounded = [];
	for (const result of results) {
		if (bounded.length >= Number(topK || 5)) break;
		const nextChars = String(result.text || '').length;
		if (bounded.length > 0 && usedChars + nextChars > Number(maxChars || 8000)) break;
		usedChars += nextChars;
		bounded.push(result);
	}
	return bounded;
}
