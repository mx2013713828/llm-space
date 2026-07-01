import { promises as fs } from 'fs';
import path from 'path';

import { buildPersistedSessionState, readSessionState } from '../sessions/sessionState.js';

const DEFAULT_SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');

function isValidHarnessId(harnessId) {
  return /^[a-zA-Z0-9_-]+$/.test(harnessId);
}

export function registerSessionRoutes(app, {
  sessionsDir = DEFAULT_SESSIONS_DIR,
  fsImpl = fs,
} = {}) {
  app.get('/api/sessions/:harnessId', async (req, res) => {
    try {
      const harnessId = req.params.harnessId;
      if (!isValidHarnessId(harnessId)) {
        return res.status(400).json({ error: '非法的 Harness ID' });
      }
      const sessionState = await readSessionState(sessionsDir, harnessId);
      if (!sessionState) {
        return res.json(null);
      }
      res.json(sessionState);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sessions/:harnessId', async (req, res) => {
    try {
      const harnessId = req.params.harnessId;
      if (!isValidHarnessId(harnessId)) {
        return res.status(400).json({ error: '非法的 Harness ID' });
      }
      const { messages, todos, backgroundTasks, teamContext } = req.body;
      const sessionPath = path.join(sessionsDir, `${harnessId}.json`);
      const sessionState = await buildPersistedSessionState({
        sessionsDir,
        harnessId,
        messages: messages || [],
        todos: todos || [],
        backgroundTasks: backgroundTasks || [],
        teamContext,
      });

      await fsImpl.writeFile(sessionPath, JSON.stringify(sessionState, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/sessions/:harnessId', async (req, res) => {
    try {
      const harnessId = req.params.harnessId;
      if (!isValidHarnessId(harnessId)) {
        return res.status(400).json({ error: '非法的 Harness ID' });
      }
      const sessionPath = path.join(sessionsDir, `${harnessId}.json`);
      await fsImpl.unlink(sessionPath).catch(() => {});

      const tasksDir = path.join(sessionsDir, `${harnessId}_tasks`);
      await fsImpl.rm(tasksDir, { recursive: true, force: true }).catch(() => {});

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
