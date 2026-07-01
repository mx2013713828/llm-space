import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { registerSessionRoutes } from './sessionRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'session-routes-'));
  const sessionsDir = path.join(rootDir, 'server', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { sessionsDir };
}

test('session routes read missing sessions, persist state, preserve team context, and delete task data', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.sessionsDir, 'h1.json'), JSON.stringify({
    messages: [{ role: 'user', content: 'before' }],
    todos: [],
    backgroundTasks: [],
    teamContext: { teamId: 'team_1', agentId: 'lead', leadId: 'lead' },
  }), 'utf-8');
  await mkdir(path.join(fixture.sessionsDir, 'h1_tasks'), { recursive: true });
  await writeFile(path.join(fixture.sessionsDir, 'h1_tasks', 'task.json'), '{}', 'utf-8');

  const app = createRouteApp();
  registerSessionRoutes(app, { sessionsDir: fixture.sessionsDir });

  const missingRes = await dispatchJson(app, 'GET', '/api/sessions/missing');
  assert.equal(missingRes.status, 200);
  assert.equal(missingRes.body, null);

  const saveRes = await dispatchJson(app, 'POST', '/api/sessions/h1', {
    body: {
      messages: [{ role: 'assistant', content: 'after' }],
      todos: [{ id: 'todo-1' }],
      backgroundTasks: [{ id: 'bg-1' }],
    },
  });
  assert.equal(saveRes.status, 200);

  const loadRes = await dispatchJson(app, 'GET', '/api/sessions/h1');
  const session = loadRes.body;
  assert.deepEqual(session.teamContext, { teamId: 'team_1', agentId: 'lead', leadId: 'lead' });
  assert.deepEqual(session.todos, [{ id: 'todo-1' }]);

  const deleteRes = await dispatchJson(app, 'DELETE', '/api/sessions/h1');
  assert.equal(deleteRes.status, 200);
  await assert.rejects(access(path.join(fixture.sessionsDir, 'h1.json')));
  await assert.rejects(access(path.join(fixture.sessionsDir, 'h1_tasks')));
});
