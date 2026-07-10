export function normalizeChunkSettings(settings = {}) {
	const rawChunkSize = Number(settings?.chunkSize);
	const rawOverlap = Number(settings?.overlap);
	const chunkSize = clamp(Number.isFinite(rawChunkSize) ? Math.floor(rawChunkSize) : 1000, 200, 4000);
	const maxOverlap = Math.min(1000, Math.max(0, chunkSize - 1));
	const overlap = clamp(Number.isFinite(rawOverlap) ? Math.floor(rawOverlap) : 150, 0, maxOverlap);
	return { chunkSize, overlap };
}

export function createKnowledgeChunks({
	knowledgeBaseId,
	fileId,
	parsedDocument,
	settings = {},
} = {}) {
	const { chunkSize, overlap } = normalizeChunkSettings(settings);
	const text = normalizeText(parsedDocument?.text || '');
	if (!text) return [];

	const chunks = [];
	let start = 0;
	let index = 0;
	while (start < text.length) {
		const end = Math.min(text.length, chooseChunkEnd(text, start, chunkSize));
		const chunkText = text.slice(start, end).trim();
		if (chunkText) {
			chunks.push({
				id: `chk_${fileId}_${String(index).padStart(4, '0')}`,
				knowledgeBaseId,
				fileId,
				chunkIndex: index,
				text: chunkText,
				start,
				end,
				source: {
					...(parsedDocument?.metadata || {}),
					chunkIndex: index,
				},
			});
			index += 1;
		}
		if (end >= text.length) break;
		start = Math.max(start + 1, end - overlap);
	}
	return chunks;
}

export function normalizeText(value) {
	return String(value || '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t\f\v]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function chooseChunkEnd(text, start, chunkSize) {
	const hardEnd = Math.min(text.length, start + chunkSize);
	if (hardEnd >= text.length) return hardEnd;
	const window = text.slice(start, hardEnd);
	const separators = ['\n\n', '\n', '。', '. ', ' '];
	for (const separator of separators) {
		const idx = window.lastIndexOf(separator);
		if (idx >= Math.floor(chunkSize * 0.45)) {
			return start + idx + separator.length;
		}
	}
	return hardEnd;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}
