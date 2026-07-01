import test from 'node:test';
import assert from 'node:assert/strict';

import { createActiveJobRegistry } from '../agent/activeJobs.js';
import { registerAgentRunRoutes } from './agentRunRoutes.js';
import { createRouteApp, findRouteHandler } from './routeTestUtils.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSseResponse() {
  const closeHandlers = [];
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    flushHeaders() {
      this.flushed = true;
    },
    write(chunk) {
      this.chunks.push(chunk);
    },
    end() {
      if (this.ended) return;
      this.ended = true;
      for (const handler of closeHandlers) handler();
    },
    on(event, handler) {
      if (event === 'close') closeHandlers.push(handler);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function parseSseTypes(res) {
  return res.chunks.map((chunk) => JSON.parse(String(chunk).replace(/^data: /, '').trim()).type);
}

test('agent run route reserves active job before awaiting async startup work', async () => {
  const app = createRouteApp();
  const activeJobs = createActiveJobRegistry();
  const teamContextStarted = deferred();
  const teamContextRelease = deferred();
  const executorConstructed = deferred();
  const runRelease = deferred();
  let executorCount = 0;

  class FakeExecutor {
    constructor(options) {
      executorCount += 1;
      this.options = options;
      this.messages = [{ role: 'assistant', content: 'snapshot' }];
      this.todos = [{ id: 'todo-1' }];
      this.backgroundTasks = [{ id: 'bg-1' }];
      this.pendingPermission = null;
      executorConstructed.resolve();
    }

    async run() {
      await runRelease.promise;
    }
  }

  registerAgentRunRoutes(app, {
    activeJobs,
    ExecutorClass: FakeExecutor,
    resolveRunTeamContext: async () => {
      teamContextStarted.resolve();
      await teamContextRelease.promise;
      return null;
    },
    resolveSelectedStrategyId: () => 'custom',
    resolvePermission: () => false,
  });

  const { handler } = findRouteHandler(app, 'POST', '/api/agent/run');
  const firstRes = createSseResponse();
  const secondRes = createSseResponse();
  const body = {
    harnessId: 'h1',
    messages: [],
    todos: [],
    backgroundTasks: [],
    systemPrompt: '',
    tools: [],
    features: {},
    model: { key: 'test-key' },
    skills: [],
  };

  const firstRun = handler({ body }, firstRes);
  await teamContextStarted.promise;

  const secondRun = handler({ body }, secondRes);
  await Promise.resolve();

  assert.equal(activeJobs.has('h1'), true);
  assert.equal(executorCount, 0);
  assert.equal(secondRes.flushed, true);

  teamContextRelease.resolve();
  await executorConstructed.promise;
  assert.equal(executorCount, 1);

  runRelease.resolve();
  await Promise.all([firstRun, secondRun]);

  assert.equal(activeJobs.has('h1'), false);
  assert.equal(executorCount, 1);
  assert.deepEqual(parseSseTypes(firstRes), ['background_tasks_update', 'done']);
  assert.deepEqual(parseSseTypes(secondRes), ['done']);
});
