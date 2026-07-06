import crypto from 'crypto';

import { createKnowledgeChunks } from './knowledgeChunking.js';
import { loadKnowledgeDocument } from './documentLoaders.js';
import { embedKnowledgeTexts } from './embeddingProviders.js';
import { buildKeywordIndex } from './knowledgeIndex.js';
import { buildVectorIndex } from './vectorIndex.js';
import {
	loadKnowledgeBase,
	loadKnowledgeChunks,
	loadKnowledgeFiles,
	saveKnowledgeChunks,
	saveKnowledgeFiles,
	saveKnowledgeIndex,
	saveKnowledgeVectorIndex,
	updateKnowledgeBaseMetadata,
} from './knowledgeStore.js';
import { recordKnowledgePipelineEvent } from './knowledgePipelineTrace.js';

export async function previewKnowledgeChunks({
	filename,
	mimeType,
	content,
	contentBase64,
	settings = {},
} = {}) {
	const parsed = await loadKnowledgeDocument({ filename, mimeType, content, contentBase64, loaderConfig: settings });
	return createKnowledgeChunks({
		knowledgeBaseId: 'kb_preview',
		fileId: 'preview',
		parsedDocument: parsed,
		settings,
	}).map(chunk => ({
		...chunk,
		id: `preview_${String(chunk.chunkIndex).padStart(4, '0')}`,
	}));
}

export async function ingestKnowledgeFile({
	knowledgeBaseId,
	filename,
	mimeType,
	content,
	contentBase64,
	settings = {},
	knowledgeRoot,
	now = () => new Date(),
} = {}) {
	await loadKnowledgeBase({ knowledgeBaseId, knowledgeRoot });
	const runId = createRunId();
	const effectiveSettings = { ...settings };

	await recordKnowledgePipelineEvent({
		knowledgeBaseId,
		runId,
		stage: 'parse',
		status: 'running',
		summary: `Parsing ${filename}`,
		knowledgeRoot,
		now,
	});
	const parsed = await loadKnowledgeDocument({ filename, mimeType, content, contentBase64, loaderConfig: effectiveSettings });
	await recordKnowledgePipelineEvent({
		knowledgeBaseId,
		runId,
		stage: 'parse',
		status: 'completed',
		summary: `Parsed ${parsed.text.length} characters`,
		knowledgeRoot,
		now,
	});

	const file = {
		id: createFileId({ filename: parsed.metadata.filename, content, contentBase64 }),
		filename: parsed.metadata.filename,
		mimeType: parsed.metadata.mimeType || String(mimeType || ''),
		parser: parsed.metadata.parser,
		loader: parsed.metadata.loader || parsed.metadata.parser,
		size: parsed.metadata.byteLength || Buffer.byteLength(String(content ?? ''), 'utf-8'),
		importedAt: toIsoString(now()),
		settings: effectiveSettings,
	};

	await recordKnowledgePipelineEvent({
		knowledgeBaseId,
		runId,
		stage: 'chunk',
		status: 'running',
		summary: `Chunking ${file.filename}`,
		knowledgeRoot,
		now,
	});
	const chunks = createKnowledgeChunks({
		knowledgeBaseId,
		fileId: file.id,
		parsedDocument: parsed,
		settings: effectiveSettings,
	});
	await recordKnowledgePipelineEvent({
		knowledgeBaseId,
		runId,
		stage: 'chunk',
		status: 'completed',
		summary: `Created ${chunks.length} chunks`,
		knowledgeRoot,
		now,
	});

	const existingFiles = (await loadKnowledgeFiles({ knowledgeBaseId, knowledgeRoot }))
		.filter(item => item.id !== file.id);
	const existingChunks = (await loadKnowledgeChunks({ knowledgeBaseId, knowledgeRoot }))
		.filter(chunk => chunk.fileId !== file.id);
	const nextFiles = [...existingFiles, file];
	const nextChunks = [...existingChunks, ...chunks];

	await saveKnowledgeFiles({ knowledgeBaseId, files: nextFiles, knowledgeRoot });
	await saveKnowledgeChunks({ knowledgeBaseId, chunks: nextChunks, knowledgeRoot });

	await recordKnowledgePipelineEvent({
		knowledgeBaseId,
		runId,
		stage: 'index',
		status: 'running',
		summary: `Indexing ${nextChunks.length} chunks`,
		knowledgeRoot,
		now,
	});
	const index = buildKeywordIndex(nextChunks);
	await saveKnowledgeIndex({ knowledgeBaseId, index, knowledgeRoot });
	const embeddingResult = await embedKnowledgeTexts({
		texts: nextChunks.map(chunk => chunk.text),
		settings: effectiveSettings,
	});
	const vectorIndex = buildVectorIndex({
		chunks: nextChunks,
		vectors: embeddingResult.vectors,
		embeddingProvider: embeddingResult.embeddingProvider,
		embeddingModel: embeddingResult.embeddingModel,
		embeddingDimensions: embeddingResult.embeddingDimensions,
	});
	await saveKnowledgeVectorIndex({ knowledgeBaseId, index: vectorIndex, knowledgeRoot });
	await updateKnowledgeBaseMetadata({
		knowledgeBaseId,
		patch: {
			fileCount: nextFiles.length,
			chunkCount: nextChunks.length,
			vectorCount: vectorIndex.vectorCount,
			settings: effectiveSettings,
		},
		knowledgeRoot,
		now,
	});
	await recordKnowledgePipelineEvent({
		knowledgeBaseId,
		runId,
		stage: 'index',
		status: 'completed',
		summary: `Indexed ${nextChunks.length} chunks and ${vectorIndex.vectorCount} vectors`,
		knowledgeRoot,
		now,
	});

	return {
		runId,
		file,
		chunks,
	};
}

function createFileId({ filename, content, contentBase64 }) {
	const hash = crypto
		.createHash('sha1')
		.update(`${filename}\n${String(content ?? '')}`)
		.update(String(contentBase64 || ''))
		.digest('hex')
		.slice(0, 12);
	return `file_${hash}`;
}

function createRunId() {
	return `run_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function toIsoString(value) {
	if (value instanceof Date) return value.toISOString();
	return new Date(value).toISOString();
}
