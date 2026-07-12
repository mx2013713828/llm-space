import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
} from '../../src/lib/taskOrchestration.js';
import { FEATURE_SCHEMA, parseFeatures } from '../../src/lib/FeatureSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const harnessDir = path.resolve(__dirname, '../../harnesses');

async function readHarness(file) {
  const raw = await readFile(path.join(harnessDir, file), 'utf8');
  return JSON.parse(raw);
}

const trackedHarnessExpectations = {
  '01-chat-bot.json': {
    enabled: false,
    mode: 'todo',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
  '02-bash.json': {
    enabled: false,
    mode: 'todo',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
  '03-deep-research.json': {
    enabled: true,
    mode: 'todo',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
  '04-subagent.json': {
    enabled: true,
    mode: 'task_system',
    enable_background_tasks: false,
    enable_sub_agents: true,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
  '05-task-system.json': {
    enabled: true,
    mode: 'task_system',
    enable_background_tasks: false,
    enable_sub_agents: true,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
};

test('hard-migrates orchestration harnesses to canonical features', async () => {
  const todoDefaults = FEATURE_SCHEMA.task_orchestration.children.todo_prompt.defaultValue;
  const taskSystemDefaults = FEATURE_SCHEMA.task_orchestration.children.task_system_prompt.defaultValue;

  for (const [file, expected] of Object.entries(trackedHarnessExpectations)) {
    const harness = await readHarness(file);
    const parsedTaskOrchestration = parseFeatures(harness.features).task_orchestration;

    assert.equal(harness.features?.task_manager, undefined, `${file}: legacy task_manager`);
    assert.equal(harness.features?.enable_cron_scheduler, undefined, `${file}: legacy cron switch`);
    assert.ok(harness.features?.task_orchestration, `${file}: missing task_orchestration`);
    assert.deepEqual(
      (harness.tools ?? []).filter(tool => ORCHESTRATION_MANAGED_TOOL_NAMES.includes(typeof tool === 'string' ? tool : tool.name)),
      [],
      `${file}: manually mounted orchestration tool`,
    );

    assert.equal(harness.features.task_orchestration.enabled, expected.enabled, `${file}: raw enabled`);
    assert.equal(harness.features.task_orchestration.mode, expected.mode, `${file}: raw mode`);
    assert.equal(
      harness.features.task_orchestration.enable_background_tasks,
      expected.enable_background_tasks,
      `${file}: raw background toggle`,
    );
    assert.equal(
      harness.features.task_orchestration.enable_sub_agents,
      expected.enable_sub_agents,
      `${file}: raw sub-agent toggle`,
    );
    assert.equal(
      harness.features.task_orchestration.enable_agent_teams,
      expected.enable_agent_teams,
      `${file}: raw agent teams toggle`,
    );
    assert.equal(
      harness.features.task_orchestration.enable_cron_scheduler,
      expected.enable_cron_scheduler,
      `${file}: raw cron toggle`,
    );
    assert.equal(harness.features.task_orchestration.todo_prompt, todoDefaults, `${file}: todo prompt`);
    assert.equal(harness.features.task_orchestration.task_system_prompt, taskSystemDefaults, `${file}: task system prompt`);

    assert.equal(parsedTaskOrchestration.enabled, expected.enabled, `${file}: parsed enabled`);
    assert.equal(parsedTaskOrchestration.mode, expected.mode, `${file}: parsed mode`);
    assert.equal(
      parsedTaskOrchestration.enable_background_tasks,
      expected.enable_background_tasks,
      `${file}: parsed background toggle`,
    );
    assert.equal(
      parsedTaskOrchestration.enable_sub_agents,
      expected.enable_sub_agents,
      `${file}: parsed sub-agent toggle`,
    );
    assert.equal(
      parsedTaskOrchestration.enable_agent_teams,
      expected.enable_agent_teams,
      `${file}: parsed agent teams toggle`,
    );
    assert.equal(
      parsedTaskOrchestration.enable_cron_scheduler,
      expected.enable_cron_scheduler,
      `${file}: parsed cron toggle`,
    );
    assert.equal(parsedTaskOrchestration.todo_prompt, todoDefaults, `${file}: parsed todo prompt`);
    assert.equal(parsedTaskOrchestration.task_system_prompt, taskSystemDefaults, `${file}: parsed task system prompt`);
  }
});
