import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionStrategyPlugin } from './ExecutionStrategyPlugin.js';

test('preLLM pins selected strategy into system prompt', async () => {
  const context = {
    executor: {
      selectedStrategyId: 'inline',
      features: {
        task_orchestration: {
          enabled: true,
        },
      },
    },
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Implement feature' }] },
    ],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.apiMessages.length, 1);
  assert.equal(context.apiMessages[0].content.length, 1);
  assert.match(context.systemPrompt, /<available_execution_strategies>/);
  assert.match(context.systemPrompt, /<active_execution_strategy id="inline"/);
  assert.match(context.systemPrompt, /do not replace it with a more direct path/);
  assert.deepEqual(
    context.promptAssemblySections
      .filter(section => section.id.includes('execution_strategy'))
      .map(section => ({ id: section.id, target: section.target, lifecycle: section.lifecycle })),
    [
      { id: 'execution_strategy_index', target: 'system', lifecycle: 'pinned' },
      { id: 'active_execution_strategy', target: 'system', lifecycle: 'pinned' },
    ],
  );
});

test('preLLM leaves custom strategy untouched', async () => {
  const context = {
    executor: { selectedStrategyId: 'custom', features: {} },
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Implement feature' }] },
    ],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.apiMessages[0].content.length, 1);
  assert.match(context.systemPrompt, /<available_execution_strategies>/);
});

test('preLLM injects custom strategy guideline when configured', async () => {
  const context = {
    executor: {
      selectedStrategyId: 'custom',
      features: {
        task_orchestration: {
          enabled: true,
          custom_strategy_prompt: '<strategy_guidelines>Use my workflow.</strategy_guidelines>',
        },
      },
    },
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Implement feature' }] },
    ],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.apiMessages[0].content.length, 1);
  assert.match(context.systemPrompt, /<active_execution_strategy id="custom"/);
  assert.match(context.systemPrompt, /Use my workflow/);
});

test('preLLM prefers configured strategy guideline over the built-in body', async () => {
  const context = {
    executor: {
      selectedStrategyId: 'inline',
      features: {
        task_orchestration: {
          enabled: true,
          inline_strategy_prompt: '<strategy_guidelines>Custom inline rule.</strategy_guidelines>',
        },
      },
    },
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Implement feature' }] },
    ],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await ExecutionStrategyPlugin.preLLM(context);

  const injected = context.systemPrompt;
  assert.match(injected, /Custom inline rule/);
  assert.doesNotMatch(injected, /Use direct lead-agent execution/);
});

test('preLLM pins strategy compatibility note without appending after tool_result messages', async () => {
  const context = {
    executor: {
      selectedStrategyId: 'sequential_subagent',
      features: {
        task_orchestration: {
          enabled: true,
          enable_sub_agents: false,
        },
      },
    },
    apiMessages: [
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'result' },
        ],
      },
    ],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.apiMessages.length, 1);
  assert.match(context.systemPrompt, /Missing required primitives: sub_agent/);
  assert.match(context.systemPrompt, /<active_execution_strategy id="sequential_subagent"/);
});

test('preLLM skips strategy index when task orchestration is disabled', async () => {
  const context = {
    executor: {
      selectedStrategyId: 'custom',
      features: {
        task_orchestration: {
          enabled: false,
        },
      },
    },
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Implement feature' }] },
    ],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.systemPrompt, '');
});
