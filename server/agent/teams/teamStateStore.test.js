import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTeamStateStore } from './teamStateStore.js';

test('createTeam creates and persists initial team state', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-state-'));
  const store = createTeamStateStore({ rootDir });

  const created = await store.createTeam({
    harnessId: 'h1',
    teamId: 'team_1',
    teammates: [
      { agentId: 'lead', status: 'idle' },
      { agentId: 'reviewer', status: 'idle' },
    ],
  });

  assert.equal(created.teamId, 'team_1');
  assert.deepEqual(created.teammates, {
    lead: { agentId: 'lead', status: 'idle' },
    reviewer: { agentId: 'reviewer', status: 'idle' },
  });
  assert.deepEqual(await store.loadState({ harnessId: 'h1', teamId: 'team_1' }), created);

  await rm(rootDir, { recursive: true, force: true });
});

test('upsertTeammate and updateTeammate create and update teammate status', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-state-'));
  const store = createTeamStateStore({ rootDir });

  await store.createTeam({ harnessId: 'h1', teamId: 'team_1' });
  await store.upsertTeammate({
    harnessId: 'h1',
    teamId: 'team_1',
    teammate: { agentId: 'reviewer', status: 'idle' },
  });

  const updated = await store.updateTeammate({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'reviewer',
    updates: { status: 'busy', lastSeenAt: '2026-06-23T00:00:00.000Z' },
  });

  assert.deepEqual(updated.teammates.reviewer, {
    agentId: 'reviewer',
    status: 'busy',
    lastSeenAt: '2026-06-23T00:00:00.000Z',
  });

  await rm(rootDir, { recursive: true, force: true });
});

test('updateTeammate rejects missing teammates with a readable error', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-state-'));
  const store = createTeamStateStore({ rootDir });

  await store.createTeam({ harnessId: 'h1', teamId: 'team_1' });

  await assert.rejects(
    store.updateTeammate({
      harnessId: 'h1',
      teamId: 'team_1',
      agentId: 'ghost',
      updates: { status: 'busy' },
    }),
    /Unknown teammate/,
  );

  await rm(rootDir, { recursive: true, force: true });
});

test('concurrent upsertTeammate calls for one team preserve both teammates', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-state-'));
  const store = createTeamStateStore({ rootDir });

  await store.createTeam({ harnessId: 'h1', teamId: 'team_1' });

  await Promise.all([
    store.upsertTeammate({
      harnessId: 'h1',
      teamId: 'team_1',
      teammate: { agentId: 'reviewer', status: 'busy' },
    }),
    store.upsertTeammate({
      harnessId: 'h1',
      teamId: 'team_1',
      teammate: { agentId: 'implementer', status: 'idle' },
    }),
  ]);

  const saved = await store.loadState({ harnessId: 'h1', teamId: 'team_1' });
  assert.deepEqual(saved.teammates, {
    reviewer: { agentId: 'reviewer', status: 'busy' },
    implementer: { agentId: 'implementer', status: 'idle' },
  });

  await rm(rootDir, { recursive: true, force: true });
});

test('saveState rejects team ids with path traversal', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-state-'));
  const store = createTeamStateStore({ rootDir });

  await assert.rejects(
    store.saveState({
      harnessId: 'h1',
      teamId: '../escape',
      state: { teamId: '../escape', teammates: {} },
    }),
    /Invalid teamId/,
  );

  await rm(rootDir, { recursive: true, force: true });
});
