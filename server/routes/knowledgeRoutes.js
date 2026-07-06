import {
	createKnowledgeBase,
	deleteKnowledgeBase,
	loadKnowledgeFiles,
	listKnowledgeBases,
	listMountedKnowledgeBases,
	loadKnowledgeBase,
	mountKnowledgeBases,
	updateKnowledgeBaseMetadata,
} from '../knowledge/knowledgeStore.js';
import {
	ingestKnowledgeFile,
	previewKnowledgeChunks,
} from '../knowledge/knowledgeIngest.js';
import { retrieveKnowledge } from '../knowledge/knowledgeRetrieve.js';
import { getKnowledgePipelineTrace } from '../knowledge/knowledgePipelineTrace.js';

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
				settings: req.body?.settings || {},
			}));
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
				knowledgeRoot,
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
