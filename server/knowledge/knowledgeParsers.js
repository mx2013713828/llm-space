import {
	loadKnowledgeDocument,
	sanitizeFilename,
} from './documentLoaders.js';

export function parseKnowledgeFile({
	filename,
	mimeType = '',
	content = '',
	parserConfig = {},
} = {}) {
	return loadKnowledgeDocument({
		filename,
		mimeType,
		content,
		loaderConfig: parserConfig,
	});
}

export { sanitizeFilename };
