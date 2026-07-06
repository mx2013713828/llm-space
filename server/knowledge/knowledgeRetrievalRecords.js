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
	knowledgeRoot,
	now = () => new Date(),
} = {}) {
	assertSafeKnowledgeBaseId(knowledgeBaseId);
	const record = {
		id: `retrieval_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
		query: String(query || '').slice(0, 500),
		strategy: String(strategy || 'keyword'),
		resultCount: Number(resultCount || 0),
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
