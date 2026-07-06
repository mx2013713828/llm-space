import {
	loadKnowledgeBase,
	loadKnowledgeChunks,
	loadKnowledgeIndex,
} from './knowledgeStore.js';
import { embedKnowledgeTexts } from './embeddingProviders.js';
import { retrieveFromKeywordIndex } from './knowledgeIndex.js';
import { retrieveKnowledgeVectors } from './vectorStores.js';
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
		const results = await retrieveForStrategy({
			strategy: effectiveStrategy,
			query,
			chunks: kbChunks,
			keywordIndex: index,
			knowledgeBaseId,
			settings: kb.settings,
			topK: effectiveTopK,
			maxChars: effectiveMaxChars,
			scoreThreshold: effectiveScoreThreshold,
			knowledgeRoot,
		});
		const enrichedResults = results.map(chunk => ({
			...chunk,
			knowledgeBase: {
				id: kb.id,
				name: kb.name,
			},
		}));
		chunks.push(...enrichedResults);
		sources.push({ id: kb.id, name: kb.name, strategy: effectiveStrategy, resultCount: enrichedResults.length });
		if (recordRetrieval) {
			await recordKnowledgeRetrieval({
				knowledgeBaseId: kb.id,
				query,
				strategy: effectiveStrategy,
				resultCount: enrichedResults.length,
				sources: summarizeResultSources(enrichedResults),
				knowledgeRoot,
				now,
			});
		}

		await recordKnowledgePipelineEvent({
			knowledgeBaseId,
			runId,
			stage: 'retrieve',
			status: 'completed',
			summary: `Retrieved ${enrichedResults.length} chunks`,
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

async function retrieveForStrategy({
	strategy,
	query,
	chunks,
	keywordIndex,
	knowledgeBaseId,
	settings,
	topK,
	maxChars,
	scoreThreshold,
	knowledgeRoot,
}) {
	if (strategy === 'vector') {
		return retrieveVector({ query, chunks, knowledgeBaseId, settings, topK, maxChars, scoreThreshold, knowledgeRoot });
	}
	if (strategy === 'hybrid') {
		const keywordResults = retrieveFromKeywordIndex({
			query,
			chunks,
			index: keywordIndex,
			topK,
			maxChars,
			scoreThreshold,
		});
		const vectorResults = await retrieveVector({ query, chunks, knowledgeBaseId, settings, topK, maxChars, scoreThreshold, knowledgeRoot });
		return mergeHybridResults({ keywordResults, vectorResults, topK, maxChars });
	}
	return retrieveFromKeywordIndex({
		query,
		chunks,
		index: keywordIndex,
		topK,
		maxChars,
		scoreThreshold,
	});
}

async function retrieveVector({ query, chunks, knowledgeBaseId, settings, topK, maxChars, scoreThreshold, knowledgeRoot }) {
	if (settings?.embeddingProvider === 'none') return [];
	const embedding = await embedKnowledgeTexts({
		texts: [query],
		settings,
	});
	return retrieveKnowledgeVectors({
		knowledgeBaseId,
		queryVector: embedding.vectors[0],
		chunks,
		settings,
		topK,
		maxChars,
		scoreThreshold,
		knowledgeRoot,
	});
}

function mergeHybridResults({ keywordResults = [], vectorResults = [], topK, maxChars }) {
	const byId = new Map();
	for (const result of keywordResults) {
		byId.set(result.id, {
			...result,
			keywordScore: result.score,
			vectorScore: 0,
		});
	}
	for (const result of vectorResults) {
		const existing = byId.get(result.id);
		byId.set(result.id, {
			...(existing || result),
			scoreType: 'hybrid',
			keywordScore: existing?.keywordScore || 0,
			vectorScore: result.score,
		});
	}
	const merged = [...byId.values()].map(result => ({
		...result,
		scoreType: 'hybrid',
		score: (Number(result.keywordScore || 0) * 0.5) + (Number(result.vectorScore || 0) * 0.5),
	})).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	return boundCombinedResults({ chunks: merged, topK, maxChars });
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
