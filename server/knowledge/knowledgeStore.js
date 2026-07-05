import path from 'path';
import { promises as fs } from 'fs';

const DEFAULT_KNOWLEDGE_ROOT = path.join(process.cwd(), '.knowledge');
const KB_ID_PATTERN = /^kb_[a-z0-9][a-z0-9_-]*$/;
const HARNESS_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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
		topK: normalizeInteger(input.topK, 5),
		maxChars: normalizeInteger(input.maxChars, 8000),
		scoreThreshold: Number.isFinite(Number(input.scoreThreshold)) ? Number(input.scoreThreshold) : 0,
		parser: String(input.parser || 'auto'),
		indexMethod: String(input.indexMethod || 'keyword'),
	};
}

function normalizeInteger(value, fallback) {
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	return Math.floor(parsed);
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
