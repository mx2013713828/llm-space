import express from 'express';
import cors from 'cors';

import { createAccessGuard, createRateLimiter } from '../http/accessGuard.js';
import { registerAgentRunRoutes } from '../routes/agentRunRoutes.js';
import { registerHarnessRoutes } from '../routes/harnessRoutes.js';
import { registerMemoryRoutes } from '../routes/memoryRoutes.js';
import { registerModelRoutes } from '../routes/modelRoutes.js';
import { registerSessionRoutes } from '../routes/sessionRoutes.js';

export function createServerApp({
  app = express(),
  corsMiddleware = cors({ origin: ['http://localhost:5174', 'http://127.0.0.1:5174'] }),
  accessGuard = createAccessGuard(),
  rateLimiter = createRateLimiter(),
  jsonMiddleware = express.json({ limit: '4mb' }),
  legacyChatHandler,
  cronApi,
  routeDeps = {},
  registerExtraRoutes,
} = {}) {
  app.use(corsMiddleware);
  app.use(accessGuard);
  app.use(rateLimiter);
  app.use(jsonMiddleware);

  if (legacyChatHandler) {
    app.post('/api/chat', legacyChatHandler);
  }

  if (cronApi) {
    app.get('/api/harnesses/:harnessId/cron-jobs', cronApi.list);
    app.get('/api/harnesses/:harnessId/cron-runs', cronApi.listRuns);
    app.post('/api/harnesses/:harnessId/cron-jobs', cronApi.create);
    app.delete('/api/harnesses/:harnessId/cron-jobs/:jobId', cronApi.remove);
  }

  registerHarnessRoutes(app, routeDeps.harness);
  registerMemoryRoutes(app, routeDeps.memory);
  registerModelRoutes(app, routeDeps.model);
  registerSessionRoutes(app, routeDeps.session);
  registerAgentRunRoutes(app, routeDeps.agentRun);
  registerExtraRoutes?.(app);

  return app;
}
