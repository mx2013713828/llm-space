import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { parseModelsConfig } from '../modelConfig.js';
import { registerModelRoutes } from './modelRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'model-routes-'));
  const envPath = path.join(rootDir, '.env');
  await writeFile(envPath, 'PORT=3001\nMODELS_CONFIG=[{"id":"1","name":"DeepSeek","contextWindow":1000000}]\nOTHER=value\n', 'utf-8');
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { envPath };
}

test('model routes list, create, and update MODELS_CONFIG without losing other env lines', async (t) => {
  const fixture = await createFixture(t);
  const env = {};
  const app = createRouteApp();
  registerModelRoutes(app, { envPath: fixture.envPath, env });

  const listRes = await dispatchJson(app, 'GET', '/api/models');
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body[0].name, 'DeepSeek');
  assert.equal(JSON.parse(env.MODELS_CONFIG)[0].id, '1');

  const createRes = await dispatchJson(app, 'POST', '/api/models', {
    body: { id: '2', name: 'Kimi', contextWindow: 128000 },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.length, 2);

  const updateRes = await dispatchJson(app, 'PUT', '/api/models/2', {
    body: { contextWindow: 256000 },
  });
  assert.equal(updateRes.status, 200);

  const envText = await readFile(fixture.envPath, 'utf-8');
  const models = parseModelsConfig(envText);
  assert.equal(models.find(model => model.id === '2').contextWindow, 256000);
  assert.match(envText, /OTHER=value/);
});
