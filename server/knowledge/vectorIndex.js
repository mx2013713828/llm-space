export function buildVectorIndex({
	chunks = [],
	vectors = [],
	embeddingProvider = 'none',
	embeddingModel = '',
	embeddingDimensions = 0,
} = {}) {
	const items = [];
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const vector = vectors[index];
		if (!chunk?.id || !Array.isArray(vector) || vector.length === 0) continue;
		items.push({
			chunkId: chunk.id,
			vector,
		});
	}
	return {
		schema: 'llm-space.knowledge_index.vector.v1',
		embeddingProvider,
		embeddingModel,
		embeddingDimensions,
		vectorCount: items.length,
		items,
	};
}

export function retrieveFromVectorIndex({
	queryVector = [],
	chunks = [],
	index,
	topK = 5,
	maxChars = 8000,
	scoreThreshold = 0,
} = {}) {
	if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
	const byId = new Map((chunks || []).map(chunk => [chunk.id, chunk]));
	const results = (index?.items || [])
		.map(item => {
			const chunk = byId.get(item.chunkId);
			if (!chunk) return null;
			return {
				...chunk,
				score: cosineSimilarity(queryVector, item.vector),
				scoreType: 'vector',
			};
		})
		.filter(item => item?.id && item.score >= Number(scoreThreshold || 0))
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

	const bounded = [];
	let usedChars = 0;
	for (const result of results) {
		if (bounded.length >= Number(topK || 5)) break;
		const chars = String(result.text || '').length;
		if (bounded.length > 0 && usedChars + chars > Number(maxChars || 8000)) break;
		usedChars += chars;
		bounded.push(result);
	}
	return bounded;
}

export function cosineSimilarity(left = [], right = []) {
	const length = Math.min(left.length, right.length);
	if (!length) return 0;
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;
	for (let index = 0; index < length; index += 1) {
		const leftValue = Number(left[index] || 0);
		const rightValue = Number(right[index] || 0);
		dot += leftValue * rightValue;
		leftMagnitude += leftValue * leftValue;
		rightMagnitude += rightValue * rightValue;
	}
	if (!leftMagnitude || !rightMagnitude) return 0;
	return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
