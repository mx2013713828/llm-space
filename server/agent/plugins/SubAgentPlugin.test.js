import test from 'node:test';
import assert from 'node:assert/strict';

import { AgentExecutor } from '../AgentExecutor.js';
import { SubAgentPlugin } from './SubAgentPlugin.js';
import { getToolName } from '../../../src/lib/taskOrchestration.js';

test('sub-agent child executor strips normalized sub_agent tools and disables recursive delegation', async () => {
  const originalRun = AgentExecutor.prototype.run;
  const spawned = {};

  AgentExecutor.prototype.run = async function runStub() {
    spawned.tools = this.tools;
    spawned.features = this.features;
  };

  try {
    const executor = {
      tools: ['bash', 'sub_agent', { name: 'sub_agent' }, { name: 'custom_tool' }],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_sub_agents: true,
        },
      },
      model: { id: 'test-model' },
      temperature: 0.2,
      maxTokens: 1024,
      thinkingEnabled: false,
      onEvent() {},
    };
    const tool = {
      id: 'tool_123',
      toolName: 'sub_agent',
      toolInput: { prompt: 'Investigate the repository state.' },
    };

    await SubAgentPlugin.preToolUse({ executor, tool });

    assert.equal(tool.handled, true);
    assert.ok(Array.isArray(spawned.tools));
    assert.equal(spawned.tools.some(entry => getToolName(entry) === 'sub_agent'), false);
    assert.equal(spawned.features.task_orchestration.enable_sub_agents, false);
    assert.equal(spawned.tools.filter(entry => getToolName(entry) === 'get_current_time').length, 1);
  } finally {
    AgentExecutor.prototype.run = originalRun;
  }
});
