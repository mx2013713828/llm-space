import path from 'path';
import { promises as fs } from 'fs';

import { assertSafeKnowledgeBaseId, getKnowledgeBaseDir } from './knowledgeStore.js';

const MAX_RECORDS = 50;

export async function recordKnowledgeRetrieval({
	knowledgeBaseId,
	query = '',
	strategy = 'keyword',
	resultCount = 0,
	sources = [],
	settings = {},
	evaluation = {},
	knowledgeRoot,
	now = () => new Date(),
} = {}) {
	assertSafeKnowledgeBaseId(knowledgeBaseId);
	const record = {
		id: `retrieval_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
		query: String(query || '').slice(0, 500),
		strategy: String(strategy || 'keyword'),
		resultCount: Number(resultCount || 0),
		settings: normalizeSettings(settings),
		evaluation: normalizeEvaluation(evaluation),
		sources: normalizeSources(sources),
		createdAt: toIsoString(now()),
	};
	const records = await listKnowledgeRetrievalRecords({ knowledgeBaseId, knowledgeRoot });
	const next = [record, ...records].slice(0, MAX_RECORDS);
	await writeJson(getRecordsPath({ knowledgeBaseId, knowledgeRoot }), next);
	return record;
}

export async function listKnowledgeRetrievalRecords({
	knowledgeBaseId,
	knowledgeRoot,
	limit = MAX_RECORDS,
} = {}) {
	assertSafeKnowledgeBaseId(knowledgeBaseId);
	const records = await readJson(getRecordsPath({ knowledgeBaseId, knowledgeRoot }), []);
	const safeLimit = Math.max(1, Math.min(MAX_RECORDS, Math.floor(Number(limit) || MAX_RECORDS)));
	return (Array.isArray(records) ? records : []).slice(0, safeLimit);
}

function normalizeSources(sources = []) {
	const seen = new Set();
	const output = [];
	for (const source of Array.isArray(sources) ? sources : []) {
		const filename = String(source?.filename || source?.source?.filename || '').trim();
		if (!filename || seen.has(filename)) continue;
		seen.add(filename);
		output.push({
			filename,
			chunkCount: Number(source?.chunkCount || 0),
		});
	}
	return output.slice(0, 20);
}

function normalizeSettings(settings = {}) {
	const input = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
	return {
		topK: normalizeNumber(input.topK, 0),
		maxChars: normalizeNumber(input.maxChars, 0),
		scoreThreshold: normalizeNumber(input.scoreThreshold, 0),
		rerankProvider: String(input.rerankProvider || 'none'),
		rerankTopN: normalizeNumber(input.rerankTopN, 0),
	};
}

function normalizeEvaluation(evaluation = {}) {
	const input = evaluation && typeof evaluation === 'object' && !Array.isArray(evaluation) ? evaluation : {};
	return {
		rerankEnabled: Boolean(input.rerankEnabled),
		initialCount: normalizeNumber(input.initialCount, 0),
		rerankedCount: normalizeNumber(input.rerankedCount, 0),
		finalCount: normalizeNumber(input.finalCount, 0),
		injectedCount: normalizeNumber(input.injectedCount, input.finalCount || 0),
		skippedCount: normalizeNumber(input.skippedCount, 0),
		topScore: normalizeNullableNumber(input.topScore),
		topScoreType: String(input.topScoreType || ''),
		initialTop: normalizeChunkSummaries(input.initialTop),
		rerankedTop: normalizeChunkSummaries(input.rerankedTop),
		finalTop: normalizeChunkSummaries(input.finalTop),
	};
}

function normalizeChunkSummaries(chunks = []) {
	return (Array.isArray(chunks) ? chunks : [])
		.slice(0, 10)
		.map(chunk => ({
			id: String(chunk?.id || ''),
			filename: String(chunk?.filename || chunk?.source?.filename || ''),
			score: normalizeNullableNumber(chunk?.score),
			scoreType: String(chunk?.scoreType || ''),
			originalScore: normalizeNullableNumber(chunk?.originalScore),
			rerankScore: normalizeNullableNumber(chunk?.rerankScore),
		}))
		.filter(chunk => chunk.id || chunk.filename);
}

function normalizeNumber(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeNullableNumber(value) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function getRecordsPath({ knowledgeBaseId, knowledgeRoot }) {
	return path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'retrieval-records.json');
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
