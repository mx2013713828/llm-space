import { tokenizeKnowledgeText } from './knowledgeIndex.js';

const LOCAL_HASH_DIMENSIONS = 128;
const SUPPORTED_EMBEDDING_PROVIDERS = new Set(['none', 'local_hash']);

export function normalizeEmbeddingSettings(settings = {}) {
	const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
	const provider = String(input.embeddingProvider || input.embedding_provider || 'none').trim();
	const normalizedProvider = SUPPORTED_EMBEDDING_PROVIDERS.has(provider) ? provider : 'none';
	return {
		embeddingProvider: normalizedProvider,
		embeddingModel: normalizedProvider === 'local_hash'
			? String(input.embeddingModel || 'local-hash-v1')
			: '',
		embeddingDimensions: normalizedProvider === 'local_hash' ? LOCAL_HASH_DIMENSIONS : 0,
	};
}

export function isEmbeddingEnabled(settings = {}) {
	return normalizeEmbeddingSettings(settings).embeddingProvider !== 'none';
}

export async function embedKnowledgeTexts({ texts = [], settings = {} } = {}) {
	const embeddingSettings = normalizeEmbeddingSettings(settings);
	if (embeddingSettings.embeddingProvider === 'none') {
		return {
			...embeddingSettings,
			vectors: [],
		};
	}
	if (embeddingSettings.embeddingProvider === 'local_hash') {
		return {
			...embeddingSettings,
			vectors: (texts || []).map(text => embedWithLocalHash(text, embeddingSettings.embeddingDimensions)),
		};
	}
	throw new Error(`Unsupported embedding provider: ${embeddingSettings.embeddingProvider}`);
}

export function embedWithLocalHash(text, dimensions = LOCAL_HASH_DIMENSIONS) {
	const vector = new Array(dimensions).fill(0);
	for (const token of tokenizeKnowledgeText(text)) {
		const hash = hashToken(token);
		const index = hash % dimensions;
		const sign = hash % 2 === 0 ? 1 : -1;
		vector[index] += sign;
	}
	return normalizeVector(vector);
}

function normalizeVector(vector) {
	const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
	if (!magnitude) return vector;
	return vector.map(value => Number((value / magnitude).toFixed(6)));
}

function hashToken(token) {
	let hash = 2166136261;
	for (const char of String(token || '')) {
		hash ^= char.codePointAt(0);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
