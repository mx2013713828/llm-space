import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionStrategyPlugin } from './ExecutionStrategyPlugin.js';

test('preLLM injects selected strategy into last user message', async () => {
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
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.apiMessages.length, 1);
  assert.match(context.apiMessages[0].content.at(-1).text, /<active_execution_strategy id="inline"/);
  assert.match(context.systemPrompt, /<available_execution_strategies>/);
});

test('preLLM leaves custom strategy untouched', async () => {
  const context = {
    executor: { selectedStrategyId: 'custom', features: {} },
    apiMessages: [
      { role: 'user', content: [{ type: 'text', text: 'Implement feature' }] },
    ],
    systemPrompt: '',
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
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.match(context.apiMessages[0].content.at(-1).text, /<active_execution_strategy id="custom"/);
  assert.match(context.apiMessages[0].content.at(-1).text, /Use my workflow/);
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
  };

  await ExecutionStrategyPlugin.preLLM(context);

  const injected = context.apiMessages[0].content.at(-1).text;
  assert.match(injected, /Custom inline rule/);
  assert.doesNotMatch(injected, /Use direct lead-agent execution/);
});

test('preLLM appends separate user message after tool_result messages', async () => {
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
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.apiMessages.length, 2);
  assert.equal(context.apiMessages[1].role, 'user');
  assert.match(context.apiMessages[1].content[0].text, /Missing required primitives: sub_agent/);
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
  };

  await ExecutionStrategyPlugin.preLLM(context);

  assert.equal(context.systemPrompt, '');
});
