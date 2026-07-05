import path from 'path';

const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json']);

export function parseKnowledgeFile({
	filename,
	mimeType = '',
	content = '',
	parserConfig = {},
} = {}) {
	const safeFilename = sanitizeFilename(filename);
	const extension = path.extname(safeFilename).toLowerCase();
	const parser = resolveParser({ extension, mimeType, parserConfig });
	const raw = String(content ?? '');

	if (parser === 'json') {
		try {
			return buildParsedDocument({
				text: JSON.stringify(JSON.parse(raw), null, 2),
				filename: safeFilename,
				mimeType,
				parser,
			});
		} catch (err) {
			throw new Error(`Invalid JSON knowledge file: ${err.message}`, { cause: err });
		}
	}

	if (parser === 'markdown' || parser === 'text') {
		return buildParsedDocument({
			text: raw,
			filename: safeFilename,
			mimeType,
			parser,
		});
	}

	throw new Error(`Unsupported knowledge file type: ${safeFilename || mimeType}`);
}

export function sanitizeFilename(filename) {
	const base = path.basename(String(filename || '').replace(/\\/g, '/')).trim();
	if (!base) return 'untitled.txt';
	return base.replace(/[\r\n]/g, ' ');
}

function resolveParser({ extension, mimeType, parserConfig }) {
	const requested = String(parserConfig?.parser || '').toLowerCase();
	if (requested && requested !== 'auto') {
		if (['markdown', 'text', 'json'].includes(requested)) return requested;
		throw new Error(`Unsupported knowledge parser: ${requested}`);
	}

	if (extension === '.json' || /json/i.test(mimeType)) return 'json';
	if (extension === '.md' || extension === '.markdown' || /markdown/i.test(mimeType)) return 'markdown';
	if (extension === '.txt' || /^text\//i.test(mimeType)) return 'text';
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		throw new Error(`Unsupported knowledge file type: ${extension || mimeType}`);
	}
	return 'text';
}

function buildParsedDocument({ text, filename, mimeType, parser }) {
	return {
		text: String(text || ''),
		metadata: {
			filename,
			extension: path.extname(filename).toLowerCase(),
			mimeType: String(mimeType || ''),
			parser,
		},
	};
}
