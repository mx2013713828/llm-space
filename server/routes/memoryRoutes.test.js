import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createMemoryCandidate } from '../agent/memory/memoryCandidateStore.js';
import { writeMemoryFile } from '../agent/memory/memoryStore.js';
import { registerMemoryRoutes } from './memoryRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';

async function createFixture(t) {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'memory-routes-'));
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const app = createRouteApp();
  registerMemoryRoutes(app);
  return { app };
}

test('memory routes list long-term memories and candidate review actions', async (t) => {
  const { app } = await createFixture(t);

  await writeMemoryFile('h1', 'prefer-tab-indentation', 'user', '用户偏好 Tab 缩进', '用户偏好 Tab 缩进。');
  const candidate = await createMemoryCandidate({
    harnessId: 'h1',
    item: {
      name: 'possible-project-convention',
      type: 'project',
      description: '可能的项目约定',
      body: '项目可能倾向于轻量 MVP。',
    },
    reason: 'Useful but ambiguous.',
    confidence: 0.66,
    risk: 'medium',
  });

  const memoryRes = await dispatchJson(app, 'GET', '/api/memory/h1');
  assert.equal(memoryRes.status, 200);
  assert.deepEqual(memoryRes.body.map(item => item.name), ['prefer-tab-indentation']);

  const candidateRes = await dispatchJson(app, 'GET', '/api/memory/h1/candidates', {
    query: { status: 'pending' },
  });
  assert.equal(candidateRes.status, 200);
  assert.deepEqual(candidateRes.body.map(item => item.item.name), ['possible-project-convention']);

  const approveRes = await dispatchJson(app, 'POST', `/api/memory/h1/candidates/${candidate.id}/approve`, {
    body: { patch: { description: '确认后的项目约定' } },
  });
  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.status, 'approved');
  assert.equal(approveRes.body.item.description, '确认后的项目约定');

  const afterApprove = await dispatchJson(app, 'GET', '/api/memory/h1');
  assert.deepEqual(
    afterApprove.body.map(item => item.name).sort(),
    ['possible-project-convention', 'prefer-tab-indentation'],
  );

  const second = await createMemoryCandidate({
    harnessId: 'h1',
    item: {
      name: 'possible-user-preference',
      type: 'user',
      description: '可能的用户偏好',
      body: '用户可能偏好简洁实现。',
    },
    reason: 'Needs confirmation.',
    confidence: 0.6,
    risk: 'medium',
  });

  const rejectRes = await dispatchJson(app, 'POST', `/api/memory/h1/candidates/${second.id}/reject`, {
    body: { reason: 'Too vague.' },
  });
  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.body.status, 'rejected');
  assert.equal(rejectRes.body.rejectionReason, 'Too vague.');
});
