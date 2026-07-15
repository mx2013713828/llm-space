import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRuntimeRequest,
  createRuntimeRequestError,
  getRuntimeHarnessId,
} from './runtimeRequest.js';

test('getRuntimeHarnessId rejects missing harness id', () => {
  assert.throws(
    () => getRuntimeHarnessId({}),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, '缺少 harnessId');
      return true;
    }
  );
});

test('getRuntimeHarnessId rejects invalid harness id', () => {
  assert.throws(
    () => getRuntimeHarnessId({ harnessId: '../secret' }),
    (err) => {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, '非法的 Harness ID');
      return true;
    }
  );
});

test('createRuntimeRequestError preserves response metadata', () => {
  const err = createRuntimeRequestError(422, 'bad runtime request');

  assert.equal(err.statusCode, 422);
  assert.equal(err.expose, true);
  assert.equal(err.message, 'bad runtime request');
});

test('buildRuntimeRequest normalizes feature defaults and falls back to custom strategy', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'h1',
      model: { key: 'k1' },
    },
  });

  assert.equal(runtimeRequest.harnessId, 'h1');
  assert.equal(runtimeRequest.features.task_orchestration.enabled, true);
  assert.equal(runtimeRequest.features.task_orchestration.strategy, 'custom');
  assert.equal(runtimeRequest.selectedStrategyId, 'custom');
});

test('buildRuntimeRequest prefers explicit selected strategy over feature strategy', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'h1',
      selectedStrategyId: 'inline',
      features: {
        task_orchestration: {
          enabled: true,
          strategy: 'async_teams',
        },
      },
      model: { key: 'k1' },
    },
  });

  assert.equal(runtimeRequest.selectedStrategyId, 'inline');
  assert.equal(runtimeRequest.features.task_orchestration.strategy, 'async_teams');
});

test('buildRuntimeRequest normalizes step-through mode as runtime-only metadata', async () => {
	const stepped = await buildRuntimeRequest({
		body: { harnessId: 'h1', model: { key: 'k1' }, runMode: 'step_through' },
	});
	const continuous = await buildRuntimeRequest({
		body: { harnessId: 'h1', model: { key: 'k1' }, runMode: 'unexpected' },
	});

	assert.equal(stepped.runMode, 'step_through');
	assert.equal(continuous.runMode, 'continuous');
});

test('buildRuntimeRequest resolves selected model from model list when body model is omitted', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'h1',
      selectedModelId: 'model-b',
    },
    models: [
      { id: 'model-a', name: 'Model A', modelId: 'a', key: 'ka' },
      { id: 'model-b', name: 'Model B', modelId: 'b', key: 'kb', url: 'https://provider.example' },
    ],
  });

  assert.deepEqual(runtimeRequest.model, {
    id: 'model-b',
    name: 'Model B',
    modelId: 'b',
    key: 'kb',
    url: 'https://provider.example',
  });
});

test('buildRuntimeRequest prefers explicit body model over lookup model', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'h1',
      selectedModelId: 'model-b',
      model: { name: 'Inline', modelId: 'inline', key: 'inline-key' },
    },
    models: [
      { id: 'model-b', name: 'Model B', modelId: 'b', key: 'kb' },
    ],
  });

  assert.deepEqual(runtimeRequest.model, {
    name: 'Inline',
    modelId: 'inline',
    key: 'inline-key',
  });
});

test('buildRuntimeRequest restores team context from persisted session when request omits it', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'h1',
      model: { key: 'k1' },
    },
    persistedSession: {
      teamContext: {
        teamId: 'team-1',
        teammates: [{ id: 'teammate-a' }],
      },
    },
  });

  assert.deepEqual(runtimeRequest.teamContext, {
    teamId: 'team-1',
    teammates: [{ id: 'teammate-a' }],
  });
});

test('buildRuntimeRequest lets requested team context override persisted session', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'h1',
      teamContext: { teamId: 'requested-team' },
      model: { key: 'k1' },
    },
    persistedSession: {
      teamContext: { teamId: 'persisted-team' },
    },
  });

  assert.deepEqual(runtimeRequest.teamContext, { teamId: 'requested-team' });
});

test('buildRuntimeRequest keeps scheduled run payloads serializable and applies harness defaults', async () => {
  const runtimeRequest = await buildRuntimeRequest({
    body: {
      harnessId: 'scheduled_harness',
      messages: [{ role: 'user', content: '[Scheduled] 播报天气' }],
      todos: [{ id: 'todo-1', text: 'Check weather', status: 'pending' }],
      backgroundTasks: [{ id: 'bg-1', status: 'running' }],
      thinkingEnabled: true,
      features: {
        task_orchestration: {
          enabled: true,
          strategy: 'sequential_subagent',
        },
      },
    },
    harness: {
      systemPrompt: 'System prompt',
      tools: ['weather_report'],
      model: {
        selectedModelId: 'weather-model',
        temperature: 0.2,
        max_tokens: 12000,
      },
      skills: ['weather-skill'],
    },
    models: [
      { id: 'weather-model', name: 'Weather Model', modelId: 'weather-v1', key: 'weather-key' },
    ],
  });

  assert.deepEqual(runtimeRequest.messages, [{ role: 'user', content: '[Scheduled] 播报天气' }]);
  assert.deepEqual(runtimeRequest.todos, [{ id: 'todo-1', text: 'Check weather', status: 'pending' }]);
  assert.deepEqual(runtimeRequest.backgroundTasks, [{ id: 'bg-1', status: 'running' }]);
  assert.equal(runtimeRequest.systemPrompt, 'System prompt');
  assert.deepEqual(runtimeRequest.tools, ['weather_report']);
  assert.equal(runtimeRequest.model.modelId, 'weather-v1');
  assert.equal(runtimeRequest.temperature, 0.2);
  assert.equal(runtimeRequest.maxTokens, 12000);
  assert.equal(runtimeRequest.thinkingEnabled, true);
  assert.deepEqual(runtimeRequest.skills, ['weather-skill']);
  assert.equal(runtimeRequest.selectedStrategyId, 'sequential_subagent');
  assert.doesNotThrow(() => JSON.stringify(runtimeRequest));
});
