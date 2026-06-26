import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_SCHEMA, parseFeatures } from './FeatureSchema.js';

test('exposes canonical task orchestration sections', () => {
  const group = FEATURE_SCHEMA.task_orchestration;
  const legacyTaskManagerKey = ['task', 'manager'].join('_');
  const legacyCronKey = ['enable', 'cron', 'scheduler'].join('_');

  assert.equal(group.label, 'Task Orchestration');
  assert.equal(group.preserveChildrenWhenDisabled, true);
  assert.equal(group.children.strategy.section, 'Execution Strategy');
  assert.equal(group.children.strategy.defaultValue, 'custom');
  assert.equal(group.children.inline_strategy_prompt.type, 'text_area');
  assert.match(group.children.inline_strategy_prompt.defaultValue, /<strategy_guidelines>/);
  assert.equal(group.children.custom_strategy_prompt.type, 'text_area');
  assert.equal(group.children.enable_sub_agents.section, 'Delegation');
  assert.deepEqual(group.children.enable_agent_teams, {
    type: 'boolean',
    section: 'Delegation',
    label: 'Enable Agent Teams',
    description: 'Allow the lead agent to spawn finite asynchronous teammates and exchange structured team messages.',
    defaultValue: false,
    failSafeValue: false,
  });
  assert.equal(group.children.enable_cron_scheduler.section, 'Scheduling');
  assert.equal(FEATURE_SCHEMA[legacyTaskManagerKey], undefined);
  assert.equal(FEATURE_SCHEMA[legacyCronKey], undefined);
});

test('preserves disabled child selections and rejects an invalid mode', () => {
  const disabled = parseFeatures({
    task_orchestration: {
      enabled: false,
      strategy: 'sequential_subagent',
      sequential_subagent_strategy_prompt: '<strategy_guidelines>custom</strategy_guidelines>',
      mode: 'task_system',
      enable_sub_agents: true,
      enable_agent_teams: true,
      enable_cron_scheduler: true,
    }
  }).task_orchestration;

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.strategy, 'sequential_subagent');
  assert.equal(disabled.sequential_subagent_strategy_prompt, '<strategy_guidelines>custom</strategy_guidelines>');
  assert.equal(disabled.mode, 'task_system');
  assert.equal(disabled.enable_sub_agents, true);
  assert.equal(disabled.enable_agent_teams, true);
  assert.equal(disabled.enable_cron_scheduler, true);

  const invalid = parseFeatures({ task_orchestration: { enabled: true, mode: 'invalid' } });
  assert.equal(invalid.task_orchestration.mode, 'todo');
  assert.equal(parseFeatures({ task_orchestration: { strategy: 'unknown' } }).task_orchestration.strategy, 'custom');
});
