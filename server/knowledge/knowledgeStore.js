import path from 'path';
import { promises as fs } from 'fs';

const DEFAULT_KNOWLEDGE_ROOT = path.join(process.cwd(), '.knowledge');
const KB_ID_PATTERN = /^kb_[a-z0-9][a-z0-9_-]*$/;
const HARNESS_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUPPORTED_INDEX_METHODS = new Set(['keyword', 'vector', 'hybrid']);
const SUPPORTED_RETRIEVAL_STRATEGIES = new Set(['keyword', 'vector', 'hybrid']);
const SUPPORTED_EMBEDDING_PROVIDERS = new Set(['none', 'local_hash', 'zhipu_embedding_3', 'openai_compatible']);
const SUPPORTED_VECTOR_STORES = new Set(['local_json', 'qdrant']);
const SUPPORTED_RERANK_PROVIDERS = new Set(['none', 'qwen3_rerank']);

export function getKnowledgeRoot({ knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	return path.resolve(knowledgeRoot);
}

export function assertSafeKnowledgeBaseId(knowledgeBaseId) {
	if (!KB_ID_PATTERN.test(String(knowledgeBaseId || ''))) {
		throw new Error(`Invalid knowledgeBaseId: ${knowledgeBaseId}`);
	}
}

export function getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	assertSafeKnowledgeBaseId(knowledgeBaseId);
	return path.join(getKnowledgeRoot({ knowledgeRoot }), knowledgeBaseId);
}

export function getKnowledgeMountsDir({ knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	return path.join(getKnowledgeRoot({ knowledgeRoot }), '_mounts');
}

export async function createKnowledgeBase({
	name,
	description = '',
	settings = {},
	knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT,
	now = () => new Date(),
} = {}) {
	const root = getKnowledgeRoot({ knowledgeRoot });
	await fs.mkdir(root, { recursive: true });
	const id = await createUniqueKnowledgeBaseId(name, { knowledgeRoot: root });
	const timestamp = toIsoString(now());
	const knowledgeBase = {
		schema: 'llm-space.knowledge_base.v1',
		id,
		name: normalizeName(name),
		description: String(description || '').trim(),
		settings: normalizeKnowledgeSettings(settings),
		fileCount: 0,
		chunkCount: 0,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
	await writeKnowledgeBaseMetadata(knowledgeBase, { knowledgeRoot: root });
	await writeJson(path.join(getKnowledgeBaseDir(id, { knowledgeRoot: root }), 'files.json'), []);
	await writeJson(path.join(getKnowledgeBaseDir(id, { knowledgeRoot: root }), 'chunks.json'), []);
	await writeJson(path.join(getKnowledgeBaseDir(id, { knowledgeRoot: root }), 'index.json'), { schema: 'llm-space.knowledge_index.keyword.v1', terms: {}, chunkLengths: {} });
	await writeJson(path.join(getKnowledgeBaseDir(id, { knowledgeRoot: root }), 'vector-index.json'), createEmptyVectorIndex());
	return knowledgeBase;
}

export async function listKnowledgeBases({ knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	const root = getKnowledgeRoot({ knowledgeRoot });
	await fs.mkdir(root, { recursive: true });
	const entries = await fs.readdir(root, { withFileTypes: true });
	const bases = [];
	for (const entry of entries) {
		if (!entry.isDirectory() || !KB_ID_PATTERN.test(entry.name)) continue;
		try {
			bases.push(await loadKnowledgeBase({ knowledgeBaseId: entry.name, knowledgeRoot: root }));
		} catch {
			// Ignore partially written or corrupt KBs in listing.
		}
	}
	return bases.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export async function loadKnowledgeBase({ knowledgeBaseId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	const filePath = path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'metadata.json');
	const metadata = JSON.parse(await fs.readFile(filePath, 'utf-8'));
	assertSafeKnowledgeBaseId(metadata.id);
	return {
		...metadata,
		settings: normalizeKnowledgeSettings(metadata.settings || {}),
		fileCount: Number(metadata.fileCount || 0),
		chunkCount: Number(metadata.chunkCount || 0),
	};
}

export async function updateKnowledgeBaseMetadata({ knowledgeBaseId, patch = {}, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT, now = () => new Date() } = {}) {
	const current = await loadKnowledgeBase({ knowledgeBaseId, knowledgeRoot });
	const next = {
		...current,
		...patch,
		id: current.id,
		settings: normalizeKnowledgeSettings({
			...(current.settings || {}),
			...(patch.settings || {}),
		}),
		updatedAt: toIsoString(now()),
	};
	await writeKnowledgeBaseMetadata(next, { knowledgeRoot });
	return next;
}

export async function deleteKnowledgeBase({ knowledgeBaseId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	const dir = getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot });
	await fs.rm(dir, { recursive: true, force: true });
}

export async function loadKnowledgeFiles({ knowledgeBaseId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	return readJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'files.json'), []);
}

export async function saveKnowledgeFiles({ knowledgeBaseId, files, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	await writeJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'files.json'), Array.isArray(files) ? files : []);
}

export async function loadKnowledgeChunks({ knowledgeBaseId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	return readJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'chunks.json'), []);
}

export async function saveKnowledgeChunks({ knowledgeBaseId, chunks, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	await writeJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'chunks.json'), Array.isArray(chunks) ? chunks : []);
}

export async function loadKnowledgeIndex({ knowledgeBaseId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	return readJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'index.json'), { schema: 'llm-space.knowledge_index.keyword.v1', terms: {}, chunkLengths: {} });
}

export async function saveKnowledgeIndex({ knowledgeBaseId, index, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	await writeJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'index.json'), index || { terms: {}, chunkLengths: {} });
}

export async function loadKnowledgeVectorIndex({ knowledgeBaseId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	return readJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'vector-index.json'), createEmptyVectorIndex());
}

export async function saveKnowledgeVectorIndex({ knowledgeBaseId, index, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	await writeJson(path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'vector-index.json'), index || createEmptyVectorIndex());
}

export async function mountKnowledgeBases({ harnessId, knowledgeBaseIds = [], knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	if (!HARNESS_ID_PATTERN.test(String(harnessId || ''))) {
		return { harnessId, knowledgeBaseIds: [] };
	}
	const ids = [];
	for (const id of Array.isArray(knowledgeBaseIds) ? knowledgeBaseIds : []) {
		if (!KB_ID_PATTERN.test(String(id || ''))) continue;
		try {
			await loadKnowledgeBase({ knowledgeBaseId: id, knowledgeRoot });
			if (!ids.includes(id)) ids.push(id);
		} catch {
			// Ignore mounts for missing KBs.
		}
	}
	const dir = getKnowledgeMountsDir({ knowledgeRoot });
	await fs.mkdir(dir, { recursive: true });
	await writeJson(path.join(dir, `${harnessId}.json`), { harnessId, knowledgeBaseIds: ids });
	return { harnessId, knowledgeBaseIds: ids };
}

export async function listMountedKnowledgeBases({ harnessId, knowledgeRoot = DEFAULT_KNOWLEDGE_ROOT } = {}) {
	if (!HARNESS_ID_PATTERN.test(String(harnessId || ''))) return [];
	const filePath = path.join(getKnowledgeMountsDir({ knowledgeRoot }), `${harnessId}.json`);
	const data = await readJson(filePath, { knowledgeBaseIds: [] });
	return (Array.isArray(data.knowledgeBaseIds) ? data.knowledgeBaseIds : [])
		.filter(id => KB_ID_PATTERN.test(String(id || '')));
}

async function writeKnowledgeBaseMetadata(knowledgeBase, { knowledgeRoot }) {
	const dir = getKnowledgeBaseDir(knowledgeBase.id, { knowledgeRoot });
	await fs.mkdir(dir, { recursive: true });
	await writeJson(path.join(dir, 'metadata.json'), knowledgeBase);
}

async function createUniqueKnowledgeBaseId(name, { knowledgeRoot }) {
	const base = `kb_${slugifyName(name)}`;
	let candidate = base;
	let suffix = 2;
	while (await exists(path.join(getKnowledgeRoot({ knowledgeRoot }), candidate))) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	return candidate;
}

function normalizeName(value) {
	const name = String(value || '').trim();
	if (!name) throw new Error('Knowledge Base name is required');
	return name;
}

function slugifyName(value) {
	const slug = normalizeName(value)
		.toLowerCase()
		.replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
		.replace(/^-+|-+$/g, '');
	const ascii = [...slug]
		.filter(char => char.charCodeAt(0) < 128)
		.join('')
		.replace(/^-+|-+$/g, '');
	return ascii || 'knowledge-base';
}

export function normalizeKnowledgeSettings(settings = {}) {
	const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
	return {
		chunkSize: normalizeInteger(input.chunkSize, 1000),
		overlap: normalizeInteger(input.overlap, 150),
		topK: normalizeInteger(input.topK, 5, { min: 1, max: 50 }),
		maxChars: normalizeInteger(input.maxChars, 8000, { min: 500, max: 100000 }),
		scoreThreshold: Number.isFinite(Number(input.scoreThreshold)) ? Number(input.scoreThreshold) : 0,
		parser: String(input.parser || 'auto'),
		indexMethod: normalizeEnum(input.indexMethod, 'keyword', SUPPORTED_INDEX_METHODS),
		retrievalStrategy: normalizeEnum(input.retrievalStrategy, 'keyword', SUPPORTED_RETRIEVAL_STRATEGIES),
		embeddingProvider: normalizeEnum(input.embeddingProvider || input.embedding_provider, 'none', SUPPORTED_EMBEDDING_PROVIDERS),
		embeddingModel: normalizeEmbeddingModel(input),
		embeddingDimensions: normalizeEmbeddingDimensions(input),
		embeddingBaseUrl: normalizeEmbeddingBaseUrl(input),
		embeddingApiKeyEnv: normalizeEnvName(input.embeddingApiKeyEnv),
		vectorStore: normalizeEnum(input.vectorStore, 'local_json', SUPPORTED_VECTOR_STORES),
		qdrantUrl: String(input.qdrantUrl || 'http://localhost:6333').replace(/\/+$/, ''),
		qdrantCollection: String(input.qdrantCollection || '').trim().replace(/[^A-Za-z0-9_-]/g, '_'),
		qdrantApiKeyEnv: normalizeEnvName(input.qdrantApiKeyEnv),
		rerankProvider: normalizeEnum(input.rerankProvider, 'none', SUPPORTED_RERANK_PROVIDERS),
		rerankModel: normalizeRerankModel(input),
		rerankBaseUrl: normalizeRerankBaseUrl(input),
		rerankApiKeyEnv: normalizeEnvName(input.rerankApiKeyEnv || (input.rerankProvider === 'qwen3_rerank' ? 'DASHSCOPE_API_KEY' : '')),
		rerankTopN: normalizeInteger(input.rerankTopN, 0, { min: 0, max: 100 }),
		rerankInstruct: normalizeRerankInstruct(input),
	};
}

function createEmptyVectorIndex() {
	return {
		schema: 'llm-space.knowledge_index.vector.v1',
		embeddingProvider: 'none',
		embeddingModel: '',
		embeddingDimensions: 0,
		vectorCount: 0,
		items: [],
	};
}

function normalizeEmbeddingModel(input) {
	const provider = normalizeEnum(input.embeddingProvider || input.embedding_provider, 'none', SUPPORTED_EMBEDDING_PROVIDERS);
	if (provider === 'local_hash') return String(input.embeddingModel || 'local-hash-v1');
	if (provider === 'zhipu_embedding_3') return String(input.embeddingModel || 'embedding-3');
	if (provider === 'openai_compatible') return String(input.embeddingModel || 'text-embedding-3-small');
	return '';
}

function normalizeEmbeddingDimensions(input) {
	const provider = normalizeEnum(input.embeddingProvider || input.embedding_provider, 'none', SUPPORTED_EMBEDDING_PROVIDERS);
	if (provider === 'local_hash') return 128;
	if (provider === 'zhipu_embedding_3') return normalizeInteger(input.embeddingDimensions, 1024, { min: 256, max: 2048 });
	if (provider === 'openai_compatible') return normalizeInteger(input.embeddingDimensions, 1536, { min: 1, max: 8192 });
	return 0;
}

function normalizeEmbeddingBaseUrl(input) {
	const provider = normalizeEnum(input.embeddingProvider || input.embedding_provider, 'none', SUPPORTED_EMBEDDING_PROVIDERS);
	const value = String(input.embeddingBaseUrl || '').trim();
	if (value) return value;
	if (provider === 'zhipu_embedding_3') return 'https://open.bigmodel.cn/api/paas/v4/embeddings';
	if (provider === 'openai_compatible') return 'https://api.openai.com/v1/embeddings';
	return '';
}

function normalizeEnvName(value) {
	return String(value || '').trim().replace(/[^A-Za-z0-9_]/g, '');
}

function normalizeRerankModel(input) {
	const provider = normalizeEnum(input.rerankProvider, 'none', SUPPORTED_RERANK_PROVIDERS);
	if (provider === 'qwen3_rerank') return String(input.rerankModel || 'qwen3-rerank');
	return '';
}

function normalizeRerankBaseUrl(input) {
	const provider = normalizeEnum(input.rerankProvider, 'none', SUPPORTED_RERANK_PROVIDERS);
	if (provider !== 'qwen3_rerank') return '';
	return String(input.rerankBaseUrl || '').trim();
}

function normalizeRerankInstruct(input) {
	const provider = normalizeEnum(input.rerankProvider, 'none', SUPPORTED_RERANK_PROVIDERS);
	if (provider !== 'qwen3_rerank') return '';
	return String(input.rerankInstruct || 'Given a web search query, retrieve relevant passages that answer the query.');
}

function normalizeInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeEnum(value, fallback, allowedValues) {
	const normalized = String(value || fallback).trim();
	return allowedValues.has(normalized) ? normalized : fallback;
}

async function exists(filePath) {
	return fs.access(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath, fallback) {
	try {
		return JSON.parse(await fs.readFile(filePath, 'utf-8'));
	} catch {
		return fallback;
	}
}

async function writeJson(filePath, value) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

function toIsoString(value) {
	if (value instanceof Date) return value.toISOString();
	return new Date(value).toISOString();
}
