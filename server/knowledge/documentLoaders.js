import path from 'path';

const SUPPORTED_LOADERS = new Set(['markdown', 'text', 'json', 'csv']);
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.csv']);

export function loadKnowledgeDocument({
	filename,
	mimeType = '',
	content = '',
	loaderConfig = {},
} = {}) {
	const safeFilename = sanitizeFilename(filename);
	const extension = path.extname(safeFilename).toLowerCase();
	const loader = resolveDocumentLoader({ extension, mimeType, loaderConfig });
	const raw = String(content ?? '');

	if (loader === 'json') {
		return loadJsonDocument({ raw, filename: safeFilename, mimeType, loader });
	}

	if (loader === 'csv') {
		return loadCsvDocument({ raw, filename: safeFilename, mimeType, loader });
	}

	if (loader === 'markdown' || loader === 'text') {
		return buildLoadedDocument({
			text: raw,
			filename: safeFilename,
			mimeType,
			loader,
		});
	}

	throw new Error(`Unsupported knowledge document loader: ${loader}`);
}

export function sanitizeFilename(filename) {
	const base = path.basename(String(filename || '').replace(/\\/g, '/')).trim();
	if (!base) return 'untitled.txt';
	return base.replace(/[\r\n]/g, ' ');
}

export function resolveDocumentLoader({ extension = '', mimeType = '', loaderConfig = {} } = {}) {
	const requested = String(loaderConfig?.loader || loaderConfig?.parser || '').toLowerCase();
	if (requested && requested !== 'auto') {
		if (SUPPORTED_LOADERS.has(requested)) return requested;
		throw new Error(`Unsupported knowledge document loader: ${requested}`);
	}

	if (extension === '.json' || /json/i.test(mimeType)) return 'json';
	if (extension === '.csv' || /csv/i.test(mimeType)) return 'csv';
	if (extension === '.md' || extension === '.markdown' || /markdown/i.test(mimeType)) return 'markdown';
	if (extension === '.txt' || /^text\//i.test(mimeType)) return 'text';
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		throw new Error(`Unsupported knowledge file type: ${extension || mimeType}`);
	}
	return 'text';
}

function loadJsonDocument({ raw, filename, mimeType, loader }) {
	try {
		return buildLoadedDocument({
			text: JSON.stringify(JSON.parse(raw), null, 2),
			filename,
			mimeType,
			loader,
		});
	} catch (err) {
		throw new Error(`Invalid JSON knowledge file: ${err.message}`, { cause: err });
	}
}

function loadCsvDocument({ raw, filename, mimeType, loader }) {
	const rows = parseCsvRows(raw);
	const text = rows.map((row, index) => {
		if (index === 0) return `Columns: ${row.join(', ')}`;
		return row.map((cell, cellIndex) => `${rows[0]?.[cellIndex] || `Column ${cellIndex + 1}`}: ${cell}`).join('\n');
	}).join('\n\n');
	return buildLoadedDocument({
		text,
		filename,
		mimeType,
		loader,
		extraMetadata: {
			rowCount: Math.max(0, rows.length - 1),
			columnCount: rows[0]?.length || 0,
		},
	});
}

function parseCsvRows(raw) {
	const rows = [];
	let row = [];
	let cell = '';
	let quoted = false;

	for (let index = 0; index < raw.length; index += 1) {
		const char = raw[index];
		const next = raw[index + 1];
		if (quoted) {
			if (char === '"' && next === '"') {
				cell += '"';
				index += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				cell += char;
			}
			continue;
		}
		if (char === '"') {
			quoted = true;
		} else if (char === ',') {
			row.push(cell.trim());
			cell = '';
		} else if (char === '\n') {
			row.push(cell.trim());
			rows.push(row);
			row = [];
			cell = '';
		} else if (char !== '\r') {
			cell += char;
		}
	}
	if (cell || row.length) {
		row.push(cell.trim());
		rows.push(row);
	}
	return rows.filter(item => item.some(cellValue => cellValue !== ''));
}

function buildLoadedDocument({ text, filename, mimeType, loader, extraMetadata = {} }) {
	return {
		text: String(text || ''),
		metadata: {
			filename,
			extension: path.extname(filename).toLowerCase(),
			mimeType: String(mimeType || ''),
			loader,
			parser: loader,
			...extraMetadata,
		},
	};
}
