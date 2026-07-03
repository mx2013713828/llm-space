import {
  deleteMemoryFile,
  listMemoryFiles,
  writeMemoryFile,
} from '../agent/memory/memoryStore.js';
import {
  approveMemoryCandidate,
  listMemoryCandidates,
  rejectMemoryCandidate,
} from '../agent/memory/memoryCandidateStore.js';

export function registerMemoryRoutes(app, {
  memoryStore = { listMemoryFiles, deleteMemoryFile, writeMemoryFile },
  candidateStore = { listMemoryCandidates, approveMemoryCandidate, rejectMemoryCandidate },
} = {}) {
  app.get('/api/memory/:harnessId', async (req, res) => {
    try {
      const files = await memoryStore.listMemoryFiles(req.params.harnessId);
      res.json(files.map(f => ({
        filename: f.filename,
        name: f.meta.name,
        type: f.meta.type,
        description: f.meta.description,
        mtime: f.mtime,
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/memory/:harnessId/:filename', async (req, res) => {
    try {
      await memoryStore.deleteMemoryFile(req.params.harnessId, req.params.filename);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/memory/:harnessId/candidates', async (req, res) => {
    try {
      const candidates = await candidateStore.listMemoryCandidates({
        harnessId: req.params.harnessId,
        status: req.query.status,
      });
      res.json(candidates);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/memory/:harnessId/candidates/:candidateId/approve', async (req, res) => {
    try {
      const candidate = await candidateStore.approveMemoryCandidate({
        harnessId: req.params.harnessId,
        candidateId: req.params.candidateId,
        patch: req.body?.patch || {},
      });
      await memoryStore.writeMemoryFile(
        req.params.harnessId,
        candidate.item.name,
        candidate.item.type,
        candidate.item.description,
        candidate.item.body,
      );
      res.json(candidate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/memory/:harnessId/candidates/:candidateId/reject', async (req, res) => {
    try {
      const candidate = await candidateStore.rejectMemoryCandidate({
        harnessId: req.params.harnessId,
        candidateId: req.params.candidateId,
        reason: req.body?.reason || '',
      });
      res.json(candidate);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
