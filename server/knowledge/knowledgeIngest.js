import crypto from 'crypto';

import { createKnowledgeChunks } from './knowledgeChunking.js';
import { buildKeywordIndex } from './knowledgeIndex.js';
import { parseKnowledgeFile } from './knowledgeParsers.js';
import {
	loadKnowledgeBase,
	loadKnowledgeChunks,
	loadKnowledgeFiles,
	saveKnowledgeChunks,
	saveKnowledgeFiles,
	saveKnowledgeIndex,
	updateKnowledgeBaseMetadata,
} from './knowledgeStore.js';
import { recordKnowledgePipelineEvent } from './knowledgePipelineTrace.js';

export async function previewKnowledgeChunks({
	filename,
	mimeType,
	content,
	settings = {},
} = {}) {
	const parsed = parseKnowledgeFile({ filename, mimeType, content, parserConfig: settings });
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
	const parsed = parseKnowledgeFile({ filename, mimeType, content, parserConfig: effectiveSettings });
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
		id: createFileId({ filename: parsed.metadata.filename, content }),
		filename: parsed.metadata.filename,
		mimeType: parsed.metadata.mimeType || String(mimeType || ''),
		parser: parsed.metadata.parser,
		size: String(content ?? '').length,
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
	await updateKnowledgeBaseMetadata({
		knowledgeBaseId,
		patch: {
			fileCount: nextFiles.length,
			chunkCount: nextChunks.length,
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
		summary: `Indexed ${nextChunks.length} chunks`,
		knowledgeRoot,
		now,
	});

	return {
		runId,
		file,
		chunks,
	};
}

function createFileId({ filename, content }) {
	const hash = crypto
		.createHash('sha1')
		.update(`${filename}\n${String(content ?? '')}`)
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
