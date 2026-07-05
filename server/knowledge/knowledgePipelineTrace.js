import path from 'path';
import { promises as fs } from 'fs';

import { getKnowledgeBaseDir, assertSafeKnowledgeBaseId } from './knowledgeStore.js';

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_SUMMARY_CHARS = 500;

export async function recordKnowledgePipelineEvent({
	knowledgeBaseId,
	runId,
	stage,
	status,
	summary = '',
	knowledgeRoot,
	now = () => new Date(),
} = {}) {
	assertSafeTraceIds({ knowledgeBaseId, runId });
	const trace = await getKnowledgePipelineTrace({ knowledgeBaseId, runId, knowledgeRoot });
	trace.events.push({
		stage: String(stage || 'unknown'),
		status: String(status || 'unknown'),
		summary: String(summary || '').slice(0, MAX_SUMMARY_CHARS),
		timestamp: toIsoString(now()),
	});
	await writeTrace({ knowledgeBaseId, runId, trace, knowledgeRoot });
	return trace.events[trace.events.length - 1];
}

export async function getKnowledgePipelineTrace({ knowledgeBaseId, runId, knowledgeRoot } = {}) {
	assertSafeTraceIds({ knowledgeBaseId, runId });
	const filePath = getTracePath({ knowledgeBaseId, runId, knowledgeRoot });
	try {
		const data = JSON.parse(await fs.readFile(filePath, 'utf-8'));
		return {
			schema: 'llm-space.knowledge_pipeline_trace.v1',
			knowledgeBaseId,
			runId,
			events: Array.isArray(data.events) ? data.events : [],
		};
	} catch {
		return {
			schema: 'llm-space.knowledge_pipeline_trace.v1',
			knowledgeBaseId,
			runId,
			events: [],
		};
	}
}

function getTracePath({ knowledgeBaseId, runId, knowledgeRoot }) {
	return path.join(getKnowledgeBaseDir(knowledgeBaseId, { knowledgeRoot }), 'traces', `${runId}.json`);
}

async function writeTrace({ knowledgeBaseId, runId, trace, knowledgeRoot }) {
	const filePath = getTracePath({ knowledgeBaseId, runId, knowledgeRoot });
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, JSON.stringify(trace, null, 2), 'utf-8');
}

function assertSafeTraceIds({ knowledgeBaseId, runId }) {
	assertSafeKnowledgeBaseId(knowledgeBaseId);
	if (!RUN_ID_PATTERN.test(String(runId || ''))) {
		throw new Error(`Invalid knowledge pipeline runId: ${runId}`);
	}
}

function toIsoString(value) {
	if (value instanceof Date) return value.toISOString();
	return new Date(value).toISOString();
}
