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
  assert.match(group.children.inline_strategy_prompt.defaultValue, /simple one-shot requests/);
  assert.match(group.children.sequential_subagent_strategy_prompt.defaultValue, /without creating a task DAG/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /do not spawn teammates/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /spawn the teammate before doing the substantive investigation/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /wait_for_teammates/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /Do not repeatedly poll indefinitely/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /wait timeout means teammates are still running/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /do not fallback to inline synthesis/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /check_team_inbox/);
  assert.doesNotMatch(group.children.async_teams_strategy_prompt.defaultValue, /hit turn limits/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /are still running/);
  assert.match(group.children.async_teams_strategy_prompt.defaultValue, /structured brief fields/);
  assert.equal(group.children.custom_strategy_prompt.type, 'text_area');
  assert.match(group.children.todo_prompt.defaultValue, /simple one-shot requests/);
  assert.match(group.children.todo_prompt.defaultValue, /do not create or update a todo board/);
  assert.match(group.children.task_system_prompt.defaultValue, /direct sub-agent delegation/);
  assert.match(group.children.task_system_prompt.defaultValue, /do not create task-system tasks/);
  assert.equal(group.children.enable_sub_agents.section, 'Delegation');
  assert.deepEqual(group.children.enable_agent_teams, {
    type: 'boolean',
    section: 'Delegation',
    label: 'Enable Agent Teams',
    description: 'Allow the lead agent to spawn asynchronous teammates and exchange structured team messages.',
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

test('preserves configured orchestration prompts without legacy migration', () => {
  const legacyPrompt = `<execution_strategy id="custom">
No strategy guideline is active. Follow the currently enabled primitives and the user's instructions.
</execution_strategy>`;
  const parsed = parseFeatures({
    task_orchestration: {
      custom_strategy_prompt: legacyPrompt,
    }
  }).task_orchestration;

  assert.equal(parsed.custom_strategy_prompt, legacyPrompt);

  const custom = parseFeatures({
    task_orchestration: {
      custom_strategy_prompt: '<strategy_guidelines>Keep this custom workflow.</strategy_guidelines>',
    }
  }).task_orchestration;

  assert.equal(custom.custom_strategy_prompt, '<strategy_guidelines>Keep this custom workflow.</strategy_guidelines>');
});
