const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json']);

function getExtension(filename = '') {
	const trimmed = String(filename || '').trim().toLowerCase();
	const dotIndex = trimmed.lastIndexOf('.');
	return dotIndex >= 0 ? trimmed.slice(dotIndex) : '';
}

function toFiniteNumber(value, fallback = 0) {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

export function isSupportedKnowledgeFile(filename = '') {
	return SUPPORTED_EXTENSIONS.has(getExtension(filename));
}

export function formatKnowledgeFileSize(bytes = 0) {
	const size = Math.max(0, toFiniteNumber(bytes, 0));
	if (size < 1024) return `${Math.round(size)} B`;
	if (size < 1024 * 1024) return `${Number((size / 1024).toFixed(1)).toLocaleString()} KB`;
	return `${Number((size / 1024 / 1024).toFixed(1)).toLocaleString()} MB`;
}

export function normalizeKnowledgeBaseSummary(knowledgeBase = {}) {
	return {
		id: String(knowledgeBase.id || ''),
		name: String(knowledgeBase.name || '').trim() || 'Untitled knowledge base',
		description: String(knowledgeBase.description || ''),
		fileCount: toFiniteNumber(knowledgeBase.fileCount, 0),
		chunkCount: toFiniteNumber(knowledgeBase.chunkCount, 0),
		settings: normalizeRetrievalSettings(knowledgeBase.settings || {}),
		updatedAt: knowledgeBase.updatedAt || knowledgeBase.createdAt || '',
	};
}

export function normalizeRetrievalSettings(settings = {}) {
	return {
		chunkSize: toFiniteNumber(settings.chunkSize, 1000),
		overlap: toFiniteNumber(settings.overlap, 150),
		topK: toFiniteNumber(settings.topK, 5),
		maxChars: toFiniteNumber(settings.maxChars, 8000),
		scoreThreshold: toFiniteNumber(settings.scoreThreshold, 0),
		indexMethod: String(settings.indexMethod || 'keyword'),
		retrievalStrategy: String(settings.retrievalStrategy || 'keyword'),
	};
}

export function getKnowledgeBaseStatusSummary(knowledgeBase = {}, mounted = false) {
	if (mounted) return 'mounted';
	if (toFiniteNumber(knowledgeBase.chunkCount, 0) > 0) return 'indexed';
	if (toFiniteNumber(knowledgeBase.fileCount, 0) > 0) return 'processing';
	return 'empty';
}

export function buildKnowledgeFilePayload({ file, content, settings = {} }) {
	return {
		filename: file?.name || 'document.txt',
		mimeType: file?.type || '',
		size: toFiniteNumber(file?.size, 0),
		content: String(content ?? ''),
		settings: {
			chunkSize: toFiniteNumber(settings.chunkSize, 1000),
			overlap: toFiniteNumber(settings.overlap, 150),
		},
	};
}
