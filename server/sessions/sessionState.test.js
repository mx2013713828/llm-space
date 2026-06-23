import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { buildPersistedSessionState, resolveRunTeamContext } from './sessionState.js';

async function createSessionsDir() {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'session-state-'));
  const sessionsDir = path.join(rootDir, 'server', 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  return { rootDir, sessionsDir };
}

test('resolveRunTeamContext falls back to persisted teamContext when request omits or nulls it', async (t) => {
  const fixture = await createSessionsDir();
  t.after(async () => {
    await rm(fixture.rootDir, { recursive: true, force: true });
  });

  await writeFile(
    path.join(fixture.sessionsDir, 'h1.json'),
    JSON.stringify({
      messages: [],
      todos: [],
      backgroundTasks: [],
      teamContext: { teamId: 'team_1', agentId: 'lead', leadId: 'lead' },
    }),
    'utf-8',
  );

  assert.deepEqual(
    await resolveRunTeamContext({ sessionsDir: fixture.sessionsDir, harnessId: 'h1', requestedTeamContext: undefined }),
    { teamId: 'team_1', agentId: 'lead', leadId: 'lead' },
  );
  assert.deepEqual(
    await resolveRunTeamContext({ sessionsDir: fixture.sessionsDir, harnessId: 'h1', requestedTeamContext: null }),
    { teamId: 'team_1', agentId: 'lead', leadId: 'lead' },
  );
  assert.deepEqual(
    await resolveRunTeamContext({
      sessionsDir: fixture.sessionsDir,
      harnessId: 'h1',
      requestedTeamContext: { teamId: 'team_client', agentId: 'lead', leadId: 'lead' },
    }),
    { teamId: 'team_client', agentId: 'lead', leadId: 'lead' },
  );
  assert.equal(
    await resolveRunTeamContext({ sessionsDir: fixture.sessionsDir, harnessId: 'missing', requestedTeamContext: undefined }),
    null,
  );

  await writeFile(path.join(fixture.sessionsDir, 'broken.json'), '{not json', 'utf-8');
  assert.equal(
    await resolveRunTeamContext({ sessionsDir: fixture.sessionsDir, harnessId: 'broken', requestedTeamContext: undefined }),
    null,
  );
});

test('buildPersistedSessionState preserves existing teamContext for ordinary session updates', async (t) => {
  const fixture = await createSessionsDir();
  t.after(async () => {
    await rm(fixture.rootDir, { recursive: true, force: true });
  });

  await writeFile(
    path.join(fixture.sessionsDir, 'h2.json'),
    JSON.stringify({
      messages: [{ role: 'user', content: 'before' }],
      todos: [],
      backgroundTasks: [],
      teamContext: { teamId: 'team_2', agentId: 'lead', leadId: 'lead' },
    }),
    'utf-8',
  );

  assert.deepEqual(
    await buildPersistedSessionState({
      sessionsDir: fixture.sessionsDir,
      harnessId: 'h2',
      messages: [{ role: 'user', content: 'after' }],
      todos: [{ id: '1', text: 'todo' }],
      backgroundTasks: [{ id: 'bg', title: 'work' }],
    }),
    {
      messages: [{ role: 'user', content: 'after' }],
      todos: [{ id: '1', text: 'todo' }],
      backgroundTasks: [{ id: 'bg', title: 'work' }],
      teamContext: { teamId: 'team_2', agentId: 'lead', leadId: 'lead' },
    },
  );

  assert.deepEqual(
    await buildPersistedSessionState({
      sessionsDir: fixture.sessionsDir,
      harnessId: 'h2',
      messages: [],
      todos: [],
      backgroundTasks: [],
      teamContext: null,
    }),
    {
      messages: [],
      todos: [],
      backgroundTasks: [],
    },
  );
});
