import path from 'path';

import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

const SUPPORTED_LOADERS = new Set(['markdown', 'text', 'json', 'csv', 'pdf', 'docx']);
const SUPPORTED_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.pdf', '.docx']);

export async function loadKnowledgeDocument({
	filename,
	mimeType = '',
	content = '',
	contentBase64 = '',
	loaderConfig = {},
} = {}) {
	const safeFilename = sanitizeFilename(filename);
	const extension = path.extname(safeFilename).toLowerCase();
	const loader = resolveDocumentLoader({ extension, mimeType, loaderConfig });
	const buffer = normalizeContentBuffer({ content, contentBase64 });
	const raw = buffer.toString('utf-8');

	if (loader === 'json') {
		return loadJsonDocument({ raw, filename: safeFilename, mimeType, loader, byteLength: buffer.length });
	}

	if (loader === 'csv') {
		return loadCsvDocument({ raw, filename: safeFilename, mimeType, loader, byteLength: buffer.length });
	}

	if (loader === 'pdf') {
		return loadPdfDocument({ buffer, filename: safeFilename, mimeType, loader });
	}

	if (loader === 'docx') {
		return loadDocxDocument({ buffer, filename: safeFilename, mimeType, loader });
	}

	if (loader === 'markdown' || loader === 'text') {
		return buildLoadedDocument({
			text: raw,
			filename: safeFilename,
			mimeType,
			loader,
			extraMetadata: { byteLength: buffer.length },
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
	if (extension === '.pdf' || /pdf/i.test(mimeType)) return 'pdf';
	if (extension === '.docx' || /wordprocessingml\.document/i.test(mimeType)) return 'docx';
	if (extension === '.md' || extension === '.markdown' || /markdown/i.test(mimeType)) return 'markdown';
	if (extension === '.txt' || /^text\//i.test(mimeType)) return 'text';
	if (!SUPPORTED_EXTENSIONS.has(extension)) {
		throw new Error(`Unsupported knowledge file type: ${extension || mimeType}`);
	}
	return 'text';
}

export function normalizeContentBuffer({ content = '', contentBase64 = '' } = {}) {
	if (contentBase64) return Buffer.from(String(contentBase64), 'base64');
	if (Buffer.isBuffer(content)) return content;
	if (content instanceof Uint8Array) return Buffer.from(content);
	return Buffer.from(String(content ?? ''), 'utf-8');
}

function loadJsonDocument({ raw, filename, mimeType, loader, byteLength }) {
	try {
		return buildLoadedDocument({
			text: JSON.stringify(JSON.parse(raw), null, 2),
			filename,
			mimeType,
			loader,
			extraMetadata: { byteLength },
		});
	} catch (err) {
		throw new Error(`Invalid JSON knowledge file: ${err.message}`, { cause: err });
	}
}

function loadCsvDocument({ raw, filename, mimeType, loader, byteLength }) {
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
			byteLength,
			rowCount: Math.max(0, rows.length - 1),
			columnCount: rows[0]?.length || 0,
		},
	});
}

async function loadPdfDocument({ buffer, filename, mimeType, loader }) {
	let parser;
	try {
		parser = new PDFParse({ data: buffer });
		const result = await parser.getText();
		return buildLoadedDocument({
			text: result.text,
			filename,
			mimeType,
			loader,
			extraMetadata: {
				byteLength: buffer.length,
				pageCount: result.total || result.pages?.length || 0,
			},
		});
	} catch (err) {
		throw new Error(`Failed to extract PDF text: ${err.message}`, { cause: err });
	} finally {
		if (parser) await parser.destroy();
	}
}

async function loadDocxDocument({ buffer, filename, mimeType, loader }) {
	try {
		const result = await mammoth.extractRawText({ buffer });
		return buildLoadedDocument({
			text: result.value,
			filename,
			mimeType,
			loader,
			extraMetadata: {
				byteLength: buffer.length,
				warningCount: result.messages?.length || 0,
			},
		});
	} catch (err) {
		throw new Error(`Failed to extract DOCX text: ${err.message}`, { cause: err });
	}
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
