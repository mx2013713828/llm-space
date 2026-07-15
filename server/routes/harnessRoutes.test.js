import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { registerHarnessRoutes } from './harnessRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';
import { AgentExecutor } from '../agent/AgentExecutor.js';
import { createKnowledgeBase, mountKnowledgeBases } from '../knowledge/knowledgeStore.js';
import { ingestKnowledgeFile } from '../knowledge/knowledgeIngest.js';
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
  const knowledgeRoot = path.join(rootDir, 'knowledge');
  const sessionsDir = path.join(rootDir, 'server', 'sessions');
  await mkdir(harnessDir, { recursive: true });
  await mkdir(guidanceRoot, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  t.after(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });
  return { rootDir, harnessDir, guidanceRoot, knowledgeRoot, sessionsDir };
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
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const listRes = await dispatchJson(app, 'GET', '/api/harnesses');
  assert.equal(listRes.status, 200);
  assert.deepEqual(listRes.body, [
    { id: 'alpha', name: 'alpha', filename: 'alpha.json', description: 'Alpha', category: 'basic' },
    { id: 'beta', name: 'beta', filename: 'beta.json', description: 'Beta', category: 'test' },
  ]);

  const loadRes = await dispatchJson(app, 'GET', '/api/harnesses/beta');
  assert.equal(loadRes.status, 200);
  assert.equal(loadRes.body.description, 'Beta');

  const createRes = await dispatchJson(app, 'POST', '/api/harnesses', {
    body: { name: 'New Bot', description: 'Created' },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.harness.id, 'new-bot');
  assert.equal(createRes.body.harness.name, 'New Bot');
  assert.equal(createRes.body.filename, 'new-bot.json');
  assert.equal(JSON.parse(await readFile(path.join(fixture.harnessDir, 'new-bot.json'), 'utf-8')).name, 'New Bot');

  const copyRes = await dispatchJson(app, 'POST', '/api/harnesses/beta/copy');
  assert.equal(copyRes.status, 200);
  assert.equal(copyRes.body.harness.id, 'beta-copy');
  assert.equal(copyRes.body.harness.name, 'beta Copy');
  assert.equal(copyRes.body.filename, 'beta-copy.json');

  const deleteRes = await dispatchJson(app, 'DELETE', '/api/harnesses/alpha');
  assert.equal(deleteRes.status, 200);
  await assert.rejects(access(path.join(fixture.harnessDir, 'alpha.json')));
  await assert.rejects(access(path.join(fixture.sessionsDir, 'alpha.json')));
});

test('harness metadata updates preserve identity, filename, and runtime configuration', async (t) => {
  const fixture = await createFixture(t);
  const original = {
    id: 'alpha',
    name: 'Alpha',
    description: 'Original description',
    model: { name: 'deepseek-v4', max_tokens: 8192 },
    tools: ['bash', 'read_file'],
    features: { task_orchestration: { enabled: true } },
  };
  await writeFile(
    path.join(fixture.harnessDir, 'custom-storage-name.json'),
    JSON.stringify(original),
    'utf-8',
  );

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const response = await dispatchJson(app, 'PATCH', '/api/harnesses/alpha/metadata', {
    body: { name: 'Alpha Research', description: 'Updated description' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.filename, 'custom-storage-name.json');
  assert.equal(response.body.harness.id, 'alpha');
  assert.equal(response.body.harness.name, 'Alpha Research');
  assert.equal(response.body.harness.description, 'Updated description');

  const persisted = JSON.parse(await readFile(
    path.join(fixture.harnessDir, 'custom-storage-name.json'),
    'utf-8',
  ));
  assert.deepEqual(persisted.model, original.model);
  assert.deepEqual(persisted.tools, original.tools);
  assert.deepEqual(persisted.features, original.features);
  await assert.rejects(access(path.join(fixture.harnessDir, 'alpha.json')));
});

test('harness copy route accepts custom display metadata', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'Alpha',
    description: 'Original',
    tools: ['bash'],
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const response = await dispatchJson(app, 'POST', '/api/harnesses/alpha/copy', {
    body: { name: 'Alpha Sandbox', description: 'Safe experiments' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.filename, 'alpha-sandbox.json');
  assert.equal(response.body.harness.id, 'alpha-sandbox');
  assert.equal(response.body.harness.name, 'Alpha Sandbox');
  assert.equal(response.body.harness.description, 'Safe experiments');
  assert.deepEqual(response.body.harness.tools, ['bash']);
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
      includeDebugSummaries: true,
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
    'list_mounted_knowledge_bases',
    'query_knowledge_base',
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
      includeDebugSummaries: true,
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
      includeDebugSummaries: true,
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

test('harness dry-run static context mode avoids LLM-backed memory selection', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');

  let selectedConcreteMemory = false;

  class FailingSummaryExecutor extends AgentExecutor {
    constructor(args) {
      super({
        ...args,
        memoryDependencies: {
          readIndex: async () => '- [stable](stable.md) — Stable memory',
          selectAndLoadMemories: async () => {
            selectedConcreteMemory = true;
            return ['should not be injected'];
          },
        },
      });
    }

    async _callLLMNonStream() {
      throw new Error('static context dry-run must not call LLM');
    }
  }

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
    ExecutorClass: FailingSummaryExecutor,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      dryRunMode: 'static_context',
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      tools: ['bash'],
      features: {
        enable_memory: { enabled: true },
      },
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.equal(selectedConcreteMemory, false);
  assert.equal(JSON.stringify(res.body.messages).includes('<memory_context>'), false);
});

test('harness dry-run returns prompt assembly sections for sent model context only', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      dryRunMode: 'static_context',
      messages: [{ role: 'user', turn: 1, content: 'Inspect context.' }],
      systemPrompt: 'You are helpful.',
      tools: ['bash'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          strategy: 'async_teams',
          enable_agent_teams: true,
        },
      },
      selectedStrategyId: 'async_teams',
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.promptAssembly.sections.map(section => section.id).filter(id => [
      'agent_guidance',
      'runtime_context',
      'execution_strategy_index',
      'active_execution_strategy',
      'todo_guidelines',
    ].includes(id)),
    [
      'agent_guidance',
      'runtime_context',
      'execution_strategy_index',
      'active_execution_strategy',
      'todo_guidelines',
    ],
  );
  assert.equal(res.body.promptAssembly.sections.every(section => section.sentToModel), true);
  assert.equal('toolPoolSummary' in res.body, false);
  assert.equal('runtimeNotificationSummary' in res.body, false);
  assert.equal('memoryCandidateSummary' in res.body, false);
});

test('harness dry-run includes mounted knowledge manifest and retrieved chunks', async (t) => {
  const fixture = await createFixture(t);
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'alpha.json',
    description: 'Alpha',
  }), 'utf-8');
  const kb = await createKnowledgeBase({
    name: 'Project Docs',
    description: 'RAG design notes',
    knowledgeRoot: fixture.knowledgeRoot,
  });
  await ingestKnowledgeFile({
    knowledgeBaseId: kb.id,
    filename: 'rag.md',
    content: 'RAG retrieves external project context for user questions.',
    knowledgeRoot: fixture.knowledgeRoot,
  });
  await mountKnowledgeBases({
    harnessId: 'alpha',
    knowledgeBaseIds: [kb.id],
    knowledgeRoot: fixture.knowledgeRoot,
  });

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
    knowledgeRoot: fixture.knowledgeRoot,
  });

  const res = await dispatchJson(app, 'POST', '/api/harnesses/alpha/dry-run', {
    body: {
      dryRunMode: 'static_context',
      messages: [{ role: 'user', turn: 1, content: 'What knowledge bases are mounted for RAG?' }],
      tools: ['bash'],
      features: {
        knowledge_bases: {
          enabled: true,
          strategy: 'auto_rag',
          auto_retrieve: true,
          knowledge_tools: false,
        },
      },
      model: { modelId: 'test', key: 'test' },
    },
  });

  assert.equal(res.status, 200);
  const mountedSection = res.body.promptAssembly.sections.find(section => section.id === 'mounted_knowledge_manifest');
  const retrievedSection = res.body.promptAssembly.sections.find(section => section.id === 'retrieved_knowledge');
  assert.equal(mountedSection?.target, 'system');
  assert.equal(retrievedSection?.target, 'user');
  assert.match(mountedSection?.content || '', /<mounted_knowledge_manifest>/);
  assert.match(mountedSection?.content || '', /Project Docs/);
  assert.match(retrievedSection?.content || '', /<retrieved_knowledge>/);
  assert.match(JSON.stringify(res.body.messages), /RAG retrieves external project context/);
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
  assert.equal(res.body.name, 'alpha');
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
  assert.equal(savedHarness.name, 'alpha');
  assert.equal(savedHarness.description, 'Alpha updated');
  assert.equal(savedHarness.systemPrompt, undefined);
  assert.deepEqual(savedHarness.tools, ['bash', 'read_file']);

  const loadRes = await dispatchJson(app, 'GET', '/api/harnesses/alpha');
  assert.equal(loadRes.status, 200);
  assert.equal(loadRes.body.systemPrompt, 'Updated AGENTS guidance.');
});

test('harness persistence compacts knowledge runtime config and copies', async (t) => {
  const fixture = await createFixture(t);
  const legacyKnowledge = {
    enabled: true,
    strategy: 'auto_rag',
    auto_retrieve: true,
    knowledge_tools: false,
    topK: 40,
    maxChars: 8000,
    scoreThreshold: 0.25,
  };
  await writeFile(path.join(fixture.harnessDir, 'alpha.json'), JSON.stringify({
    id: 'alpha',
    name: 'Alpha',
    description: 'RAG test',
    features: { knowledge_bases: legacyKnowledge },
  }), 'utf-8');

  const app = createRouteApp();
  registerHarnessRoutes(app, {
    harnessDir: fixture.harnessDir,
    guidanceRoot: fixture.guidanceRoot,
    sessionsDir: fixture.sessionsDir,
  });

  const copyRes = await dispatchJson(app, 'POST', '/api/harnesses/alpha/copy');
  assert.equal(copyRes.status, 200);
  assert.deepEqual(copyRes.body.harness.features.knowledge_bases, {
    enabled: true,
    strategy: 'auto_rag',
  });

  const saveRes = await dispatchJson(app, 'POST', '/api/harnesses/alpha', {
    body: {
      id: 'alpha',
      name: 'Alpha',
      description: 'RAG test',
      features: { knowledge_bases: legacyKnowledge },
    },
  });
  assert.equal(saveRes.status, 200);
  const saved = JSON.parse(await readFile(path.join(fixture.harnessDir, 'alpha.json'), 'utf-8'));
  assert.deepEqual(saved.features.knowledge_bases, {
    enabled: true,
    strategy: 'auto_rag',
  });
});
