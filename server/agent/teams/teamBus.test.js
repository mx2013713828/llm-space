import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTeamBus } from './teamBus.js';

test('sendMessage appends JSONL into the receiver inbox', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-bus-'));
  const bus = createTeamBus({ rootDir });

  await bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'hello' },
  });

  const inboxPath = path.join(rootDir, 'h1_teams', 'team_1', 'inboxes', 'reviewer.jsonl');
  const inboxRaw = await readFile(inboxPath, 'utf-8');

  assert.equal(inboxRaw.trim().split('\n').length, 1);
  assert.match(inboxRaw, /"to":"reviewer"/);

  await rm(rootDir, { recursive: true, force: true });
});

test('peekInbox reads messages without consuming them', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-bus-'));
  const bus = createTeamBus({ rootDir });

  await bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'hello' },
  });

  const firstPeek = await bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'reviewer' });
  const secondPeek = await bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'reviewer' });

  assert.equal(firstPeek.length, 1);
  assert.deepEqual(secondPeek, firstPeek);

  await rm(rootDir, { recursive: true, force: true });
});

test('readInbox consumes valid messages and preserves malformed lines in .bad', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-bus-'));
  const bus = createTeamBus({ rootDir });

  await bus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'hello' },
  });

  const inboxPath = path.join(rootDir, 'h1_teams', 'team_1', 'inboxes', 'reviewer.jsonl');
  await writeFile(inboxPath, `${await readFile(inboxPath, 'utf-8')}not-json\n`, 'utf-8');

  const messages = await bus.readInbox({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'reviewer',
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(await bus.peekInbox({ harnessId: 'h1', teamId: 'team_1', agentId: 'reviewer' }), []);
  assert.equal(await readFile(inboxPath, 'utf-8'), '');
  assert.equal(await readFile(`${inboxPath}.bad`, 'utf-8'), 'not-json\n');

  await rm(rootDir, { recursive: true, force: true });
});

test('readInbox keeps messages appended after snapshot handoff for the next read', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-bus-'));
  const writerBus = createTeamBus({ rootDir });
  const bus = createTeamBus({
    rootDir,
    _testHooks: {
      async afterInboxSnapshot() {
        await writerBus.sendMessage({
          harnessId: 'h1',
          teamId: 'team_1',
          from: 'lead',
          to: 'reviewer',
          type: 'message',
          payload: { text: 'second' },
        });
      },
    },
  });

  await writerBus.sendMessage({
    harnessId: 'h1',
    teamId: 'team_1',
    from: 'lead',
    to: 'reviewer',
    type: 'message',
    payload: { text: 'first' },
  });

  const firstRead = await bus.readInbox({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'reviewer',
  });
  const secondRead = await bus.readInbox({
    harnessId: 'h1',
    teamId: 'team_1',
    agentId: 'reviewer',
  });

  assert.equal(firstRead.length, 1);
  assert.equal(firstRead[0].payload.text, 'first');
  assert.equal(secondRead.length, 1);
  assert.equal(secondRead[0].payload.text, 'second');

  await rm(rootDir, { recursive: true, force: true });
});

test('sendMessage rejects harness ids with path traversal', async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'team-bus-'));
  const bus = createTeamBus({ rootDir });

  await assert.rejects(
    bus.sendMessage({
      harnessId: '../escape',
      teamId: 'team_1',
      from: 'lead',
      to: 'reviewer',
      type: 'message',
      payload: { text: 'hello' },
    }),
    /Invalid harnessId/,
  );

  await rm(rootDir, { recursive: true, force: true });
});
