const SUPPORTED_RERANK_PROVIDERS = new Set(['none', 'qwen3_rerank']);
const DEFAULT_QWEN_RERANK_MODEL = 'qwen3-rerank';
const DEFAULT_QWEN_RERANK_INSTRUCT = 'Given a web search query, retrieve relevant passages that answer the query.';

export function normalizeRerankSettings(settings = {}) {
	const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
	const provider = SUPPORTED_RERANK_PROVIDERS.has(String(input.rerankProvider || 'none'))
		? String(input.rerankProvider || 'none')
		: 'none';
	return {
		rerankProvider: provider,
		rerankModel: provider === 'qwen3_rerank'
			? String(input.rerankModel || DEFAULT_QWEN_RERANK_MODEL)
			: '',
		rerankBaseUrl: provider === 'qwen3_rerank' ? String(input.rerankBaseUrl || '').trim() : '',
		rerankApiKeyEnv: normalizeEnvName(input.rerankApiKeyEnv || (provider === 'qwen3_rerank' ? 'DASHSCOPE_API_KEY' : '')),
		rerankTopN: normalizeInteger(input.rerankTopN, 0, { min: 0, max: 100 }),
		rerankInstruct: provider === 'qwen3_rerank'
			? String(input.rerankInstruct || DEFAULT_QWEN_RERANK_INSTRUCT)
			: '',
	};
}

export function isRerankEnabled(settings = {}) {
	return normalizeRerankSettings(settings).rerankProvider !== 'none';
}

export async function rerankKnowledgeChunks({
	query = '',
	chunks = [],
	settings = {},
	topN,
	fetchImpl = globalThis.fetch,
	env = globalThis.process?.env || {},
} = {}) {
	const rerankSettings = normalizeRerankSettings(settings);
	const safeChunks = Array.isArray(chunks) ? chunks : [];
	if (rerankSettings.rerankProvider === 'none' || safeChunks.length <= 1) {
		return {
			...rerankSettings,
			chunks: safeChunks,
			usage: null,
		};
	}
	if (rerankSettings.rerankProvider === 'qwen3_rerank') {
		return rerankWithQwen3({
			query,
			chunks: safeChunks,
			settings: rerankSettings,
			topN,
			fetchImpl,
			env,
		});
	}
	throw new Error(`Unsupported rerank provider: ${rerankSettings.rerankProvider}`);
}

async function rerankWithQwen3({ query, chunks, settings, topN, fetchImpl, env }) {
	if (!settings.rerankBaseUrl) {
		throw new Error('Qwen rerank requires rerankBaseUrl, e.g. https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-api/v1/reranks');
	}
	const apiKey = resolveApiKey({ settings, env });
	if (!apiKey) {
		throw new Error(`Missing rerank API key env: ${settings.rerankApiKeyEnv || 'DASHSCOPE_API_KEY'}`);
	}
	const finalTopN = Number(topN || settings.rerankTopN || chunks.length);
	const response = await fetchImpl(settings.rerankBaseUrl, {
		method: 'POST',
		headers: {
			'authorization': `Bearer ${apiKey}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			model: settings.rerankModel,
			query: String(query || ''),
			documents: chunks.map(chunk => String(chunk?.text || '')),
			top_n: Math.min(chunks.length, Math.max(1, finalTopN)),
			instruct: settings.rerankInstruct,
		}),
	});
	if (!response.ok) {
		const errorText = await response.text().catch(() => '');
		throw new Error(`Rerank API error ${response.status}: ${errorText || response.statusText}`);
	}
	const data = await response.json();
	const reranked = normalizeQwenResults(data.results)
		.map(result => {
			const chunk = chunks[result.index];
			if (!chunk) return null;
			return {
				...chunk,
				originalScore: chunk.score,
				score: result.relevanceScore,
				rerankScore: result.relevanceScore,
				scoreType: 'rerank',
			};
		})
		.filter(Boolean);
	return {
		...settings,
		chunks: reranked,
		usage: data.usage || null,
	};
}

function normalizeQwenResults(results = []) {
	return (Array.isArray(results) ? results : [])
		.map(item => ({
			index: Number(item?.index),
			relevanceScore: Number(item?.relevance_score),
		}))
		.filter(item => Number.isInteger(item.index) && Number.isFinite(item.relevanceScore))
		.sort((a, b) => b.relevanceScore - a.relevanceScore || a.index - b.index);
}

function normalizeInteger(value, fallback, { min, max }) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeEnvName(value) {
	return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}

function resolveApiKey({ settings, env }) {
	return env?.[settings.rerankApiKeyEnv || 'DASHSCOPE_API_KEY'] || '';
}
