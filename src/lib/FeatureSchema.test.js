import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_SCHEMA, parseFeatures } from './FeatureSchema.js';

test('exposes canonical task orchestration sections', () => {
  const group = FEATURE_SCHEMA.task_orchestration;
  const legacyTaskManagerKey = ['task', 'manager'].join('_');
  const legacyCronKey = ['enable', 'cron', 'scheduler'].join('_');

  assert.equal(group.label, 'Task Orchestration');
  assert.equal(group.preserveChildrenWhenDisabled, true);
  assert.equal(group.children.enable_sub_agents.section, 'Delegation');
  assert.equal(group.children.enable_cron_scheduler.section, 'Scheduling');
  assert.equal(FEATURE_SCHEMA[legacyTaskManagerKey], undefined);
  assert.equal(FEATURE_SCHEMA[legacyCronKey], undefined);
});

test('preserves disabled child selections and rejects an invalid mode', () => {
  const disabled = parseFeatures({
    task_orchestration: {
      enabled: false,
      mode: 'task_system',
      enable_sub_agents: true,
      enable_cron_scheduler: true,
    }
  }).task_orchestration;

  assert.equal(disabled.enabled, false);
  assert.equal(disabled.mode, 'task_system');
  assert.equal(disabled.enable_sub_agents, true);
  assert.equal(disabled.enable_cron_scheduler, true);

  const invalid = parseFeatures({ task_orchestration: { enabled: true, mode: 'invalid' } });
  assert.equal(invalid.task_orchestration.mode, 'todo');
});
