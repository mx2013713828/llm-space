import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStrategyContextBlock,
  buildStrategyIndexBlock,
  getMissingRequiredPrimitives,
  listExecutionStrategies,
  loadExecutionStrategy,
  parseStrategyFrontmatter,
  resolveSelectedStrategyId,
} from './strategyRegistry.js';

test('lists strategy metadata without guideline bodies', async () => {
  const strategies = await listExecutionStrategies();
  const sequential = strategies.find(strategy => strategy.id === 'sequential_subagent');

  assert.ok(sequential);
  assert.equal(sequential.name, 'Sequential Sub-agent Workflow');
  assert.deepEqual(sequential.requiredPrimitives, ['task_orchestration', 'sub_agent']);
  assert.equal(Object.hasOwn(sequential, 'body'), false);
});

test('loads selected strategy body lazily', async () => {
  const strategy = await loadExecutionStrategy('async_teams');

  assert.equal(strategy.id, 'async_teams');
  assert.match(strategy.body, /<strategy_guidelines>/);
  assert.match(strategy.body, /simple one-shot requests/);
});

test('sequential strategy allows simple direct sub-agent delegation', async () => {
  const strategy = await loadExecutionStrategy('sequential_subagent');

  assert.match(strategy.body, /call `sub_agent` directly/);
  assert.match(strategy.body, /without creating a task DAG/);
});

test('rejects unknown strategies', async () => {
  await assert.rejects(
    () => loadExecutionStrategy('missing_strategy'),
    /Unknown execution strategy: missing_strategy/
  );
});

test('parses simple YAML arrays and strips frontmatter from body', () => {
  const parsed = parseStrategyFrontmatter(`---
id: demo
required_primitives:
  - task_orchestration
  - sub_agent
recommended_primitives: []
---
body`);

  assert.equal(parsed.meta.id, 'demo');
  assert.deepEqual(parsed.meta.required_primitives, ['task_orchestration', 'sub_agent']);
  assert.deepEqual(parsed.meta.recommended_primitives, []);
  assert.equal(parsed.body, 'body');
});

test('resolves selected strategy from explicit id before feature defaults', () => {
  assert.equal(resolveSelectedStrategyId({
    explicitStrategyId: 'inline',
    features: { task_orchestration: { strategy: 'custom' } },
  }), 'inline');
  assert.equal(resolveSelectedStrategyId({
    features: { task_orchestration: { strategy: 'async_teams' } },
  }), 'async_teams');
});

test('reports missing required primitives without granting capabilities', async () => {
  const strategy = await loadExecutionStrategy('sequential_subagent');
  const features = {
    task_orchestration: {
      enabled: true,
      enable_sub_agents: false,
    },
  };

  assert.deepEqual(getMissingRequiredPrimitives(strategy, features), ['sub_agent']);
  assert.match(buildStrategyContextBlock(strategy, features), /Missing required primitives: sub_agent/);
});

test('builds a compact strategy index without guideline bodies', async () => {
  const strategies = await listExecutionStrategies();
  const index = buildStrategyIndexBlock(strategies);

  assert.match(index, /<available_execution_strategies>/);
  assert.match(index, /sequential_subagent: Sequential Sub-agent Workflow/);
  assert.doesNotMatch(index, /<execution_strategy id=/);
});
