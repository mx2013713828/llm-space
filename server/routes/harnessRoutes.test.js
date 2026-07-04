import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { registerHarnessRoutes } from './harnessRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';
import {
  defaultRuntimeNotificationQueue,
  drainRuntimeNotifications,
  enqueueRuntimeNotification,
  peekRuntimeNotifications,
} from '../agent/runtimeNotifications.js';

async function createFixture(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'harness-routes-'));
  const harnessDir = path.join(rootDir, 'harnesses');
  const guidanceRoot = path.join(rootDir, 'guidance');
  const sessionsDir = path.join(rootDir, 'server', 'sessions');
  await mkdir(harnessDir, { recursive: true });
  await mkdir(guidanceRoot, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir, harnessDir, guidanceRoot, sessionsDir };
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

test('harness dry-run returns compact tool pool summary from runtime tools', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    sessionsDir: fixture.sessionsDir,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      tools: ['bash', 'sub_agent'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'task_system',
          enable_sub_agents: true,
        },
      },
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.toolPoolSummary.runtimeRole, 'lead');
  assert.deepEqual(res.body.toolPoolSummary.names, [
    'bash',
    'create_task',
    'list_tasks',
    'get_task',
    'claim_task',
    'complete_task',
    'sub_agent',
    'get_current_time',
  ]);
  assert.deepEqual(
    res.body.tools.map(tool => tool.name).sort(),
    [...res.body.toolPoolSummary.names].sort(),
  );
});

test('harness dry-run reports notification summary without consuming the live queue', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');
  drainRuntimeNotifications({ harnessId: 'alpha', limit: 100, queue: defaultRuntimeNotificationQueue });
  enqueueRuntimeNotification({
    harnessId: 'alpha',
    source: 'team',
    type: 'team_inbox',
    payload: { text: 'Live teammate result.' },
  }, defaultRuntimeNotificationQueue);

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    sessionsDir: fixture.sessionsDir,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      tools: ['bash'],
      features: {},
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.runtimeNotificationSummary.unreadCount, 0);
  assert.equal(JSON.stringify(res.body.messages).includes('Live teammate result.'), false);
  assert.equal(peekRuntimeNotifications({ harnessId: 'alpha', queue: defaultRuntimeNotificationQueue }).length, 1);
  drainRuntimeNotifications({ harnessId: 'alpha', limit: 100, queue: defaultRuntimeNotificationQueue });
});

test('harness dry-run reports memory candidate summary without loading full candidate bodies', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    sessionsDir: fixture.sessionsDir,
    memoryCandidateStore: {
      async listMemoryCandidates({ harnessId }) {
        assert.equal(harnessId, 'alpha');
        return [
          {
            id: 'memcand_1',
            status: 'pending',
            item: {
              name: 'possible-project-convention',
              description: '可能的项目约定',
              body: 'x'.repeat(2000),
            },
            reason: 'Useful but ambiguous.',
          },
          {
            id: 'memcand_2',
            status: 'approved',
            item: { name: 'approved-memory', description: '已批准', body: 'approved body' },
          },
        ];
      },
    },
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      tools: ['bash'],
      features: {},
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.memoryCandidateSummary.counts, {
    pending: 1,
    approved: 1,
    rejected: 0,
  });
  assert.deepEqual(res.body.memoryCandidateSummary.previews, [
    {
      id: 'memcand_1',
      status: 'pending',
      name: 'possible-project-convention',
      description: '可能的项目约定',
      reason: 'Useful but ambiguous.',
    },
    {
      id: 'memcand_2',
      status: 'approved',
      name: 'approved-memory',
      description: '已批准',
      reason: '',
    },
  ]);
  assert.equal(JSON.stringify(res.body.memoryCandidateSummary).includes('xxxx'), false);
});

test('harness load initializes AGENTS.md from legacy system prompt', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
    systemPrompt: 'Legacy prompt from JSON.',
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const res = await dispatchJson(app, 'GET', '/api/harnesses/alpha');

  assert.equal(res.status, 200);
  assert.equal(res.body.systemPrompt, 'Legacy prompt from JSON.');
  assert.deepEqual(res.body.guidance, {
    file: 'guidance/alpha/AGENTS.md',
    filename: 'AGENTS.md',
    source: 'initialized_from_legacy',
  });
  assert.equal(
    await readFile(path.join(fixture.guidanceRoot, 'alpha', 'AGENTS.md'), 'utf-8'),
    'Legacy prompt from JSON.',
  );
});

test('harness save writes systemPrompt to AGENTS.md and strips it from JSON', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
    systemPrompt: 'Legacy prompt from JSON.',
    tools: ['bash'],
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha', {
    body: {
      id: 'alpha',
      name: 'alpha.json',
      description: 'Alpha updated',
      systemPrompt: 'Updated AGENTS guidance.',
      tools: ['bash', 'read_file'],
    },
  });

  assert.equal(res.status, 200);
  assert.equal(
    await readFile(path.join(fixture.guidanceRoot, 'alpha', 'AGENTS.md'), 'utf-8'),
    'Updated AGENTS guidance.',
  );
  const savedHarness = JSON.parse(await readFile(path.join(fixture.harnessDir, 'alpha.json'), 'utf-8'));
  assert.equal(savedHarness.description, 'Alpha updated');
  assert.equal(savedHarness.systemPrompt, undefined);
  assert.deepEqual(savedHarness.tools, ['bash', 'read_file']);

  const loadRes = await dispatchJson(app, 'GET', '/api/harnesses/alpha');
  assert.equal(loadRes.status, 200);
  assert.equal(loadRes.body.systemPrompt, 'Updated AGENTS guidance.');
});
