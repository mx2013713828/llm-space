import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  approveMemoryCandidate,
  createMemoryCandidate,
  listMemoryCandidates,
  rejectMemoryCandidate,
} from './memoryCandidateStore.js';

test('creates, lists, approves, and rejects memory candidates', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'memory-candidates-'));
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const first = await createMemoryCandidate({
    harnessId: 'h1',
    item: {
      name: 'possible-project-convention',
      type: 'project',
      description: '可能的项目约定',
      body: '项目可能倾向于轻量 MVP。',
    },
    source: { kind: 'conversation' },
    reason: 'Useful but ambiguous.',
    confidence: 0.66,
    risk: 'medium',
    now: () => new Date('2026-07-03T00:00:00.000Z'),
  });

  const second = await createMemoryCandidate({
    harnessId: 'h1',
    item: {
      name: 'possible-user-preference',
      type: 'user',
      description: '可能的用户偏好',
      body: '用户可能偏好简洁实现。',
    },
    source: { kind: 'conversation' },
    reason: 'Needs confirmation.',
    confidence: 0.6,
    risk: 'medium',
    now: () => new Date('2026-07-03T00:01:00.000Z'),
  });

  assert.match(first.id, /^memcand_/);
  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');

  assert.deepEqual(
    (await listMemoryCandidates({ harnessId: 'h1', status: 'pending' })).map(candidate => candidate.item.name),
    ['possible-user-preference', 'possible-project-convention'],
  );

  const approved = await approveMemoryCandidate({
    harnessId: 'h1',
    candidateId: first.id,
    patch: { description: '确认后的项目约定' },
    now: () => new Date('2026-07-03T00:02:00.000Z'),
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.item.description, '确认后的项目约定');

  const rejected = await rejectMemoryCandidate({
    harnessId: 'h1',
    candidateId: second.id,
    reason: 'Too vague.',
    now: () => new Date('2026-07-03T00:03:00.000Z'),
  });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejectionReason, 'Too vague.');

  assert.equal((await listMemoryCandidates({ harnessId: 'h1', status: 'pending' })).length, 0);
  assert.equal((await listMemoryCandidates({ harnessId: 'h1', status: 'approved' })).length, 1);
  assert.equal((await listMemoryCandidates({ harnessId: 'h1', status: 'rejected' })).length, 1);
});

test('memory candidate store rejects unsafe ids', async () => {
  await assert.rejects(
    createMemoryCandidate({
      harnessId: '../bad',
      item: { name: 'x', type: 'user', description: 'x', body: 'x' },
    }),
    /harnessId/,
  );

  await assert.rejects(
    approveMemoryCandidate({
      harnessId: 'h1',
      candidateId: '../bad',
    }),
    /candidateId/,
  );
});
