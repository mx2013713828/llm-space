import { tokenizeKnowledgeText } from './knowledgeIndex.js';

const LOCAL_HASH_DIMENSIONS = 128;
const SUPPORTED_EMBEDDING_PROVIDERS = new Set(['none', 'local_hash', 'zhipu_embedding_3', 'openai_compatible']);
const DEFAULT_ZHIPU_EMBEDDING_URL = 'https://open.bigmodel.cn/api/paas/v4/embeddings';
const DEFAULT_OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';

export function normalizeEmbeddingSettings(settings = {}) {
	const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
	const provider = String(input.embeddingProvider || input.embedding_provider || 'none').trim();
	const normalizedProvider = SUPPORTED_EMBEDDING_PROVIDERS.has(provider) ? provider : 'none';
	const model = String(input.embeddingModel || '').trim();
	const dimensions = normalizeDimensions(input.embeddingDimensions, normalizedProvider);
	return {
		embeddingProvider: normalizedProvider,
		embeddingModel: normalizeEmbeddingModel({ provider: normalizedProvider, model }),
		embeddingDimensions: dimensions,
		embeddingBaseUrl: normalizeEmbeddingBaseUrl({ provider: normalizedProvider, baseUrl: input.embeddingBaseUrl }),
		embeddingApiKeyEnv: normalizeApiKeyEnv(input.embeddingApiKeyEnv),
	};
}

export function isEmbeddingEnabled(settings = {}) {
	return normalizeEmbeddingSettings(settings).embeddingProvider !== 'none';
}

export async function embedKnowledgeTexts({ texts = [], settings = {}, fetchImpl = globalThis.fetch, env = process.env } = {}) {
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
	if (embeddingSettings.embeddingProvider === 'zhipu_embedding_3' || embeddingSettings.embeddingProvider === 'openai_compatible') {
		const vectors = await embedWithOpenAICompatibleApi({
			texts,
			settings: embeddingSettings,
			fetchImpl,
			env,
		});
		return {
			...embeddingSettings,
			vectors,
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

async function embedWithOpenAICompatibleApi({ texts = [], settings, fetchImpl, env }) {
	if (typeof fetchImpl !== 'function') throw new Error('Embedding provider requires fetch support');
	const apiKey = resolveApiKey({ settings, env });
	if (!apiKey) {
		throw new Error(`Missing embedding API key env: ${settings.embeddingApiKeyEnv || defaultApiKeyEnv(settings.embeddingProvider)}`);
	}
	
	const BATCH_SIZE = 64;
	const allVectors = [];
	
	for (let i = 0; i < texts.length; i += BATCH_SIZE) {
		const batchTexts = texts.slice(i, i + BATCH_SIZE);
		const response = await fetchImpl(settings.embeddingBaseUrl, {
			method: 'POST',
			headers: {
				'authorization': `Bearer ${apiKey}`,
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				model: settings.embeddingModel,
				input: batchTexts.map(text => String(text || '')),
				...(settings.embeddingDimensions ? { dimensions: settings.embeddingDimensions } : {}),
			}),
		});
		if (!response.ok) {
			const errorText = await response.text().catch(() => '');
			throw new Error(`Embedding API error ${response.status}: ${errorText || response.statusText}`);
		}
		const data = await response.json();
		const batchVectors = (data.data || [])
			.sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
			.map(item => item.embedding);
		if (batchVectors.length !== batchTexts.length || batchVectors.some(vector => !Array.isArray(vector))) {
			throw new Error('Embedding API returned invalid vector data');
		}
		allVectors.push(...batchVectors);
	}
	
	return allVectors;
}

function normalizeEmbeddingModel({ provider, model }) {
	if (provider === 'local_hash') return model || 'local-hash-v1';
	if (provider === 'zhipu_embedding_3') return model || 'embedding-3';
	if (provider === 'openai_compatible') return model || 'text-embedding-3-small';
	return '';
}

function normalizeEmbeddingBaseUrl({ provider, baseUrl }) {
	const value = String(baseUrl || '').trim();
	if (value) return value;
	if (provider === 'zhipu_embedding_3') return DEFAULT_ZHIPU_EMBEDDING_URL;
	if (provider === 'openai_compatible') return DEFAULT_OPENAI_EMBEDDING_URL;
	return '';
}

function normalizeDimensions(value, provider) {
	if (provider === 'local_hash') return LOCAL_HASH_DIMENSIONS;
	if (provider === 'zhipu_embedding_3') return normalizeInteger(value, 1024, { min: 256, max: 2048 });
	if (provider === 'openai_compatible') return normalizeInteger(value, 1536, { min: 1, max: 8192 });
	return 0;
}

function normalizeInteger(value, fallback, { min, max }) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeApiKeyEnv(value) {
	return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}

function resolveApiKey({ settings, env }) {
	const keyName = settings.embeddingApiKeyEnv || defaultApiKeyEnv(settings.embeddingProvider);
	return env?.[keyName] || '';
}

function defaultApiKeyEnv(provider) {
	if (provider === 'zhipu_embedding_3') return 'ZHIPU_API_KEY';
	if (provider === 'openai_compatible') return 'OPENAI_API_KEY';
	return '';
}
