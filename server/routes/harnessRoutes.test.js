import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { registerHarnessRoutes } from './harnessRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'harness-routes-'));
  const harnessDir = path.join(rootDir, 'harnesses');
  const sessionsDir = path.join(rootDir, 'server', 'sessions');
  await mkdir(harnessDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir, harnessDir, sessionsDir };
}

test('harness routes list, load, create, copy, and delete harness files', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'beta.json'), JSON.stringify({
    id: 'beta',
    name: 'beta.json',
    description: 'Beta',
    category: 'test',
  }), 'utf-8');
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');
  await writeFile(path.join(fixture.sessionsDir, 'alpha.json'), JSON.stringify({ messages: ['old'] }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    sessionsDir: fixture.sessionsDir,
  });

  const listRes = await dispatchJson(app, 'GET', '/api/harnesses');
  assert.equal(listRes.status, 200);
  assert.deepEqual(listRes.body, [
    { id: 'alpha', name: 'alpha.json', description: 'Alpha', category: 'basic' },
    { id: 'beta', name: 'beta.json', description: 'Beta', category: 'test' },
  ]);

  const loadRes = await dispatchJson(app, 'GET', '/api/harnesses/beta');
  assert.equal(loadRes.status, 200);
  assert.equal(loadRes.body.description, 'Beta');

  const createRes = await dispatchJson(app, 'POST', '/api/harnesses', {
    body: { name: 'New Bot', description: 'Created' },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.harness.id, 'new-bot');
  assert.equal(JSON.parse(await readFile(path.join(fixture.harnessDir, 'New Bot.json'), 'utf-8')).id, 'new-bot');

  const copyRes = await dispatchJson(app, 'POST', '/api/harnesses/beta/copy');
  assert.equal(copyRes.status, 200);
  assert.equal(copyRes.body.harness.id, 'beta-copy');

  const deleteRes = await dispatchJson(app, 'DELETE', '/api/harnesses/alpha');
  assert.equal(deleteRes.status, 200);
  await assert.rejects(access(path.join(fixture.harnessDir, 'alpha.json')));
  await assert.rejects(access(path.join(fixture.sessionsDir, 'alpha.json')));
});
