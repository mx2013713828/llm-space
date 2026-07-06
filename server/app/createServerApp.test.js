import test from 'node:test';
import assert from 'node:assert/strict';

import { createActiveJobRegistry } from '../agent/activeJobs.js';
import { allowLocalDevOrigins, createServerApp } from './createServerApp.js';
import { createRouteApp } from '../routes/routeTestUtils.js';

test('createServerApp installs runtime middleware and core route groups', () => {
  const app = createRouteApp();
  createServerApp({
    app,
    corsMiddleware: 'cors',
    accessGuard: 'access',
    rateLimiter: 'rate',
    jsonMiddleware: 'json',
    legacyChatHandler: () => {},
    routeDeps: {
      agentRun: { activeJobs: createActiveJobRegistry() },
    },
  });

  assert.deepEqual(app.middleware, ['cors', 'access', 'rate', 'json']);
  assert.deepEqual(
    app.routes.map(route => `${route.method} ${route.pattern}`).sort(),
    [
      'DELETE /api/harnesses/:id',
      'DELETE /api/knowledge-bases/:knowledgeBaseId',
      'DELETE /api/memory/:harnessId/:filename',
      'DELETE /api/sessions/:harnessId',
      'GET /api/agent/status/:harnessId',
      'GET /api/harnesses',
      'GET /api/harnesses/:id',
      'GET /api/health',
      'GET /api/harnesses/:harnessId/knowledge-bases',
      'GET /api/knowledge-bases',
      'GET /api/knowledge-bases/:knowledgeBaseId',
      'GET /api/knowledge-bases/:knowledgeBaseId/files',
      'GET /api/knowledge-bases/:knowledgeBaseId/retrieval-records',
      'GET /api/knowledge-bases/:knowledgeBaseId/traces/:runId',
      'GET /api/memory/:harnessId',
      'GET /api/memory/:harnessId/candidates',
      'GET /api/models',
      'GET /api/sessions/:harnessId',
      'PATCH /api/knowledge-bases/:knowledgeBaseId',
      'POST /api/agent/permission',
      'POST /api/agent/run',
      'POST /api/chat',
      'POST /api/harnesses',
      'POST /api/harnesses/:harnessId/dry-run',
      'POST /api/harnesses/:harnessId/knowledge-bases',
      'POST /api/harnesses/:id',
      'POST /api/harnesses/:id/copy',
      'POST /api/knowledge-bases',
      'POST /api/knowledge-bases/:knowledgeBaseId/files',
      'POST /api/knowledge-bases/preview-chunks',
      'POST /api/knowledge-bases/retrieve',
      'POST /api/knowledge-bases/test-embedding',
      'POST /api/memory/:harnessId/candidates/:candidateId/approve',
      'POST /api/memory/:harnessId/candidates/:candidateId/reject',
      'POST /api/models',
      'POST /api/sessions/:harnessId',
      'PUT /api/models/:id',
    ].sort(),
  );
});

test('allowLocalDevOrigins accepts Vite fallback ports during local development', async () => {
  const result = await evaluateCorsOrigin('http://localhost:5176');
  assert.deepEqual(result, { error: null, allowed: true });

  const loopbackResult = await evaluateCorsOrigin('http://127.0.0.1:5188');
  assert.deepEqual(loopbackResult, { error: null, allowed: true });

  const rejectedResult = await evaluateCorsOrigin('https://example.com');
  assert.deepEqual(rejectedResult, { error: null, allowed: false });
});

function evaluateCorsOrigin(origin) {
  return new Promise(resolve => {
    allowLocalDevOrigins(origin, (error, allowed) => {
      resolve({ error, allowed });
    });
  });
}
