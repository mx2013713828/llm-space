import crypto from 'crypto';

import {
	loadKnowledgeVectorIndex,
	saveKnowledgeVectorIndex,
} from './knowledgeStore.js';
import { buildVectorIndex, retrieveFromVectorIndex } from './vectorIndex.js';

const SUPPORTED_VECTOR_STORES = new Set(['local_json', 'qdrant']);
const DEFAULT_QDRANT_URL = 'http://localhost:6333';

export function normalizeVectorStoreSettings(settings = {}) {
	const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
	const vectorStore = SUPPORTED_VECTOR_STORES.has(String(input.vectorStore || 'local_json'))
		? String(input.vectorStore || 'local_json')
		: 'local_json';
	return {
		vectorStore,
		qdrantUrl: String(input.qdrantUrl || DEFAULT_QDRANT_URL).replace(/\/+$/, ''),
		qdrantCollection: normalizeCollectionName(input.qdrantCollection),
		qdrantApiKeyEnv: normalizeApiKeyEnv(input.qdrantApiKeyEnv),
	};
}

export async function persistKnowledgeVectors({
	knowledgeBaseId,
	chunks = [],
	vectors = [],
	embedding,
	settings = {},
	knowledgeRoot,
	fetchImpl = globalThis.fetch,
	env = process.env,
} = {}) {
	const vectorStore = normalizeVectorStoreSettings(settings);
	const collection = vectorStore.qdrantCollection || defaultCollectionName(knowledgeBaseId);
	const index = buildVectorIndex({
		chunks,
		vectors,
		embeddingProvider: embedding.embeddingProvider,
		embeddingModel: embedding.embeddingModel,
		embeddingDimensions: embedding.embeddingDimensions,
	});
	await saveKnowledgeVectorIndex({ knowledgeBaseId, index: {
		...index,
		vectorStore: vectorStore.vectorStore,
		qdrantCollection: vectorStore.vectorStore === 'qdrant' ? collection : '',
	}, knowledgeRoot });

	if (vectorStore.vectorStore === 'qdrant' && index.vectorCount > 0) {
		await ensureQdrantCollection({
			settings: vectorStore,
			collection,
			dimensions: embedding.embeddingDimensions,
			fetchImpl,
			env,
		});
		await upsertQdrantVectors({
			settings: vectorStore,
			collection,
			knowledgeBaseId,
			chunks,
			vectors,
			fetchImpl,
			env,
		});
	}
	return {
		...index,
		vectorStore: vectorStore.vectorStore,
		qdrantCollection: vectorStore.vectorStore === 'qdrant' ? collection : '',
	};
}

export async function retrieveKnowledgeVectors({
	knowledgeBaseId,
	queryVector,
	chunks = [],
	settings = {},
	topK,
	maxChars,
	scoreThreshold,
	knowledgeRoot,
	fetchImpl = globalThis.fetch,
	env = process.env,
} = {}) {
	const vectorStore = normalizeVectorStoreSettings(settings);
	if (vectorStore.vectorStore === 'qdrant') {
		return searchQdrantVectors({
			settings: vectorStore,
			collection: vectorStore.qdrantCollection || defaultCollectionName(knowledgeBaseId),
			queryVector,
			topK,
			scoreThreshold,
			fetchImpl,
			env,
		});
	}
	const index = await loadKnowledgeVectorIndex({ knowledgeBaseId, knowledgeRoot });
	return retrieveFromVectorIndex({
		queryVector,
		chunks,
		index,
		topK,
		maxChars,
		scoreThreshold,
	});
}

async function ensureQdrantCollection({ settings, collection, dimensions, fetchImpl, env }) {
	const response = await qdrantFetch({
		settings,
		env,
		fetchImpl,
		path: `/collections/${encodeURIComponent(collection)}`,
		method: 'PUT',
		body: {
			vectors: {
				size: dimensions,
				distance: 'Cosine',
			},
		},
	});
	if (response.status === 409) {
		return;
	}
	if (!response.ok) {
		throw new Error(`Qdrant collection error ${response.status}: ${await safeText(response)}`);
	}
}

async function upsertQdrantVectors({ settings, collection, knowledgeBaseId, chunks, vectors, fetchImpl, env }) {
	const points = [];
	for (let index = 0; index < chunks.length; index += 1) {
		const chunk = chunks[index];
		const vector = vectors[index];
		if (!chunk?.id || !Array.isArray(vector)) continue;
		points.push({
			id: toQdrantPointId(`${knowledgeBaseId}:${chunk.id}`),
			vector,
			payload: {
				knowledgeBaseId,
				chunkId: chunk.id,
				fileId: chunk.fileId,
				filename: chunk.source?.filename || '',
				loader: chunk.source?.loader || chunk.source?.parser || '',
				chunkIndex: chunk.chunkIndex,
				text: chunk.text,
				source: chunk.source || {},
			},
		});
	}
	const response = await qdrantFetch({
		settings,
		env,
		fetchImpl,
		path: `/collections/${encodeURIComponent(collection)}/points?wait=true`,
		method: 'PUT',
		body: { points },
	});
	if (!response.ok) {
		throw new Error(`Qdrant upsert error ${response.status}: ${await safeText(response)}`);
	}
}

async function searchQdrantVectors({ settings, collection, queryVector, topK, scoreThreshold, fetchImpl, env }) {
	const response = await qdrantFetch({
		settings,
		env,
		fetchImpl,
		path: `/collections/${encodeURIComponent(collection)}/points/search`,
		method: 'POST',
		body: {
			vector: queryVector,
			limit: Number(topK || 5),
			with_payload: true,
			score_threshold: Number(scoreThreshold || 0),
		},
	});
	if (!response.ok) {
		throw new Error(`Qdrant search error ${response.status}: ${await safeText(response)}`);
	}
	const data = await response.json();
	return (data.result || []).map(point => ({
		id: point.payload?.chunkId || String(point.id),
		fileId: point.payload?.fileId || '',
		chunkIndex: point.payload?.chunkIndex || 0,
		text: point.payload?.text || '',
		source: point.payload?.source || { filename: point.payload?.filename || '' },
		score: Number(point.score || 0),
		scoreType: 'vector',
	}));
}

async function qdrantFetch({ settings, env, fetchImpl, path, method, body }) {
	const headers = { 'content-type': 'application/json' };
	const apiKey = resolveApiKey({ settings, env });
	if (apiKey) headers['api-key'] = apiKey;
	return fetchImpl(`${settings.qdrantUrl}${path}`, {
		method,
		headers,
		body: JSON.stringify(body),
	});
}

function defaultCollectionName(knowledgeBaseId) {
	return `llm_space_${String(knowledgeBaseId || 'kb').replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function normalizeCollectionName(value) {
	return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

function normalizeApiKeyEnv(value) {
	return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}

function resolveApiKey({ settings, env }) {
	return settings.qdrantApiKeyEnv ? (env?.[settings.qdrantApiKeyEnv] || '') : '';
}

function toQdrantPointId(value) {
	const hash = crypto.createHash('sha1').update(String(value)).digest('hex');
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

async function safeText(response) {
	return response.text().catch(() => response.statusText || '');
}
