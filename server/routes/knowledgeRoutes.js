import {
	createKnowledgeBase,
	deleteKnowledgeBase,
	loadKnowledgeFiles,
	listKnowledgeBases,
	listMountedKnowledgeBases,
	loadKnowledgeMount,
	loadKnowledgeBase,
	mountKnowledgeBases,
	updateKnowledgeMountConfig,
	updateKnowledgeBaseMetadata,
} from '../knowledge/knowledgeStore.js';
import {
	ingestKnowledgeFile,
	previewKnowledgeChunks,
} from '../knowledge/knowledgeIngest.js';
import { embedKnowledgeTexts } from '../knowledge/embeddingProviders.js';
import { rerankKnowledgeChunks } from '../knowledge/rerankProviders.js';
import { retrieveKnowledge } from '../knowledge/knowledgeRetrieve.js';
import { getKnowledgePipelineTrace } from '../knowledge/knowledgePipelineTrace.js';
import { listKnowledgeRetrievalRecords } from '../knowledge/knowledgeRetrievalRecords.js';

export function registerKnowledgeRoutes(app, { knowledgeRoot } = {}) {
	app.get('/api/knowledge-bases', async (_req, res) => {
		try {
			res.json(await listKnowledgeBases({ knowledgeRoot }));
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	});

	app.post('/api/knowledge-bases', async (req, res) => {
		try {
			const kb = await createKnowledgeBase({
				name: req.body?.name,
				description: req.body?.description || '',
				settings: req.body?.settings || {},
				knowledgeRoot,
			});
			res.json(kb);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.get('/api/knowledge-bases/:knowledgeBaseId', async (req, res) => {
		try {
			res.json(await loadKnowledgeBase({ knowledgeBaseId: req.params.knowledgeBaseId, knowledgeRoot }));
		} catch (err) {
			res.status(404).json({ error: err.message });
		}
	});

	app.patch('/api/knowledge-bases/:knowledgeBaseId', async (req, res) => {
		try {
			const patch = {};
			if (Object.hasOwn(req.body || {}, 'name')) patch.name = req.body.name;
			if (Object.hasOwn(req.body || {}, 'description')) patch.description = req.body.description || '';
			if (Object.hasOwn(req.body || {}, 'settings')) patch.settings = req.body.settings || {};
			res.json(await updateKnowledgeBaseMetadata({
				knowledgeBaseId: req.params.knowledgeBaseId,
				patch,
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.get('/api/knowledge-bases/:knowledgeBaseId/files', async (req, res) => {
		try {
			res.json(await loadKnowledgeFiles({
				knowledgeBaseId: req.params.knowledgeBaseId,
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(404).json({ error: err.message });
		}
	});

	app.delete('/api/knowledge-bases/:knowledgeBaseId', async (req, res) => {
		try {
			await deleteKnowledgeBase({ knowledgeBaseId: req.params.knowledgeBaseId, knowledgeRoot });
			res.json({ success: true });
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/knowledge-bases/preview-chunks', async (req, res) => {
		try {
			res.json(await previewKnowledgeChunks({
				filename: req.body?.filename,
				mimeType: req.body?.mimeType,
				content: req.body?.content,
				contentBase64: req.body?.contentBase64,
				settings: req.body?.settings || {},
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/knowledge-bases/test-embedding', async (req, res) => {
		try {
			const result = await embedKnowledgeTexts({
				texts: [req.body?.text || 'LLM Space embedding test'],
				settings: req.body?.settings || {},
			});
			res.json({
				embeddingProvider: result.embeddingProvider,
				embeddingModel: result.embeddingModel,
				embeddingDimensions: result.embeddingDimensions,
				vectorCount: result.vectors.length,
				vectorDimensions: result.vectors[0]?.length || 0,
			});
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/knowledge-bases/test-rerank', async (req, res) => {
		try {
			const result = await rerankKnowledgeChunks({
				query: req.body?.query || 'What is LLM Space?',
				chunks: [
					{ id: 'a', text: req.body?.positive || 'LLM Space is an agent harness workbench.' },
					{ id: 'b', text: req.body?.negative || 'The weather is cloudy today.' },
				],
				settings: req.body?.settings || {},
				topN: 2,
			});
			res.json({
				rerankProvider: result.rerankProvider,
				rerankModel: result.rerankModel,
				resultCount: result.chunks.length,
				topScore: result.chunks[0]?.rerankScore ?? result.chunks[0]?.score ?? 0,
				topId: result.chunks[0]?.id || '',
				usage: result.usage || null,
			});
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/knowledge-bases/:knowledgeBaseId/files', async (req, res) => {
		try {
			const result = await ingestKnowledgeFile({
				knowledgeBaseId: req.params.knowledgeBaseId,
				filename: req.body?.filename,
				mimeType: req.body?.mimeType,
				content: req.body?.content,
				contentBase64: req.body?.contentBase64,
				settings: req.body?.settings || {},
				knowledgeRoot,
			});
			const knowledgeBase = await loadKnowledgeBase({
				knowledgeBaseId: req.params.knowledgeBaseId,
				knowledgeRoot,
			});
			res.json({
				...result,
				chunkCount: Array.isArray(result.chunks) ? result.chunks.length : 0,
				totalChunkCount: knowledgeBase.chunkCount,
				knowledgeBase,
			});
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/knowledge-bases/retrieve', async (req, res) => {
		try {
			res.json(await retrieveKnowledge({
				knowledgeBaseIds: req.body?.knowledgeBaseIds || [],
				query: req.body?.query || '',
				topK: req.body?.topK,
				maxChars: req.body?.maxChars,
				scoreThreshold: req.body?.scoreThreshold,
				strategy: req.body?.strategy,
				rerank: req.body?.rerank,
				recordRetrieval: req.body?.recordRetrieval !== false,
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.get('/api/knowledge-bases/:knowledgeBaseId/retrieval-records', async (req, res) => {
		try {
			res.json(await listKnowledgeRetrievalRecords({
				knowledgeBaseId: req.params.knowledgeBaseId,
				knowledgeRoot,
				limit: req.query?.limit,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.get('/api/knowledge-bases/:knowledgeBaseId/traces/:runId', async (req, res) => {
		try {
			res.json(await getKnowledgePipelineTrace({
				knowledgeBaseId: req.params.knowledgeBaseId,
				runId: req.params.runId,
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.get('/api/harnesses/:harnessId/knowledge-bases', async (req, res) => {
		try {
			const ids = await listMountedKnowledgeBases({ harnessId: req.params.harnessId, knowledgeRoot });
			const bases = [];
			for (const id of ids) {
				try {
					bases.push(await loadKnowledgeBase({ knowledgeBaseId: id, knowledgeRoot }));
				} catch {
					// Ignore stale mount references.
				}
			}
			res.json(bases);
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	});

	app.get('/api/harnesses/:harnessId/knowledge-runtime', async (req, res) => {
		try {
			res.json(await loadKnowledgeMount({
				harnessId: req.params.harnessId,
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.patch('/api/harnesses/:harnessId/knowledge-runtime', async (req, res) => {
		try {
			res.json(await updateKnowledgeMountConfig({
				harnessId: req.params.harnessId,
				patch: { queryPreparation: req.body?.queryPreparation || {} },
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/harnesses/:harnessId/knowledge-bases', async (req, res) => {
		try {
			res.json(await mountKnowledgeBases({
				harnessId: req.params.harnessId,
				knowledgeBaseIds: req.body?.knowledgeBaseIds || [],
				knowledgeRoot,
			}));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});
}
