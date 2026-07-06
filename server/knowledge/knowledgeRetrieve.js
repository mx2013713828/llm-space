import {
	loadKnowledgeBase,
	loadKnowledgeChunks,
	loadKnowledgeIndex,
} from './knowledgeStore.js';
import { retrieveFromKeywordIndex } from './knowledgeIndex.js';
import { recordKnowledgePipelineEvent } from './knowledgePipelineTrace.js';
import { recordKnowledgeRetrieval } from './knowledgeRetrievalRecords.js';

export async function retrieveKnowledge({
	knowledgeBaseIds = [],
	query = '',
	topK,
	maxChars,
	scoreThreshold,
	strategy,
	knowledgeRoot,
	recordRetrieval = false,
	runId = `run_${Date.now().toString(36)}`,
	now = () => new Date(),
} = {}) {
	const ids = [...new Set(Array.isArray(knowledgeBaseIds) ? knowledgeBaseIds : [])];
	const chunks = [];
	const sources = [];
	const effectiveSettings = {
		strategy: strategy || 'keyword',
		topK: topK ?? 5,
		maxChars: maxChars ?? 8000,
		scoreThreshold: scoreThreshold ?? 0,
	};

	for (const knowledgeBaseId of ids) {
		let kb;
		try {
			kb = await loadKnowledgeBase({ knowledgeBaseId, knowledgeRoot });
		} catch {
			continue;
		}
		const effectiveTopK = topK ?? kb.settings?.topK ?? 5;
		const effectiveMaxChars = maxChars ?? kb.settings?.maxChars ?? 8000;
		const effectiveScoreThreshold = scoreThreshold ?? kb.settings?.scoreThreshold ?? 0;
		const effectiveStrategy = strategy || kb.settings?.retrievalStrategy || 'keyword';
		effectiveSettings.strategy = effectiveStrategy;
		effectiveSettings.topK = effectiveTopK;
		effectiveSettings.maxChars = effectiveMaxChars;
		effectiveSettings.scoreThreshold = effectiveScoreThreshold;
		await recordKnowledgePipelineEvent({
			knowledgeBaseId,
			runId,
			stage: 'retrieve',
			status: 'running',
			summary: `Retrieving for query: ${query} (${effectiveStrategy})`,
			knowledgeRoot,
			now,
		});

		const kbChunks = await loadKnowledgeChunks({ knowledgeBaseId, knowledgeRoot });
		const index = await loadKnowledgeIndex({ knowledgeBaseId, knowledgeRoot });
		const results = retrieveFromKeywordIndex({
			query,
			chunks: kbChunks,
			index,
			topK: effectiveTopK,
			maxChars: effectiveMaxChars,
			scoreThreshold: effectiveScoreThreshold,
		}).map(chunk => ({
			...chunk,
			knowledgeBase: {
				id: kb.id,
				name: kb.name,
			},
		}));
		chunks.push(...results);
		sources.push({ id: kb.id, name: kb.name, strategy: effectiveStrategy, resultCount: results.length });
		if (recordRetrieval) {
			await recordKnowledgeRetrieval({
				knowledgeBaseId: kb.id,
				query,
				strategy: effectiveStrategy,
				resultCount: results.length,
				sources: summarizeResultSources(results),
				knowledgeRoot,
				now,
			});
		}

		await recordKnowledgePipelineEvent({
			knowledgeBaseId,
			runId,
			stage: 'retrieve',
			status: 'completed',
			summary: `Retrieved ${results.length} chunks`,
			knowledgeRoot,
			now,
		});
	}

	const bounded = boundCombinedResults({
		chunks: chunks.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)),
		topK: topK ?? 5,
		maxChars: maxChars ?? 8000,
	});

	return {
		query: String(query || ''),
		knowledgeBaseIds: ids,
		effectiveSettings,
		sources,
		chunks: bounded,
	};
}

function summarizeResultSources(chunks = []) {
	const counts = new Map();
	for (const chunk of chunks) {
		const filename = chunk?.source?.filename;
		if (!filename) continue;
		counts.set(filename, (counts.get(filename) || 0) + 1);
	}
	return [...counts.entries()].map(([filename, chunkCount]) => ({ filename, chunkCount }));
}

function boundCombinedResults({ chunks, topK, maxChars }) {
	const output = [];
	let usedChars = 0;
	for (const chunk of chunks) {
		if (output.length >= Number(topK || 5)) break;
		const chars = String(chunk.text || '').length;
		if (output.length > 0 && usedChars + chars > Number(maxChars || 8000)) break;
		usedChars += chars;
		output.push(chunk);
	}
	return output;
}
