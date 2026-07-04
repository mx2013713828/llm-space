import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendSystemPromptSection,
  composeSystemPromptSections,
  createPromptSection,
  summarizePromptAssembly,
} from './promptAssembly.js';

test('createPromptSection normalizes metadata for sent model context', () => {
  const content = '<active_execution_strategy>...</active_execution_strategy>';
  const section = createPromptSection({
    id: 'active_execution_strategy',
    label: 'Active Strategy',
    target: 'system',
    lifecycle: 'pinned',
    source: 'strategy:async_teams',
    content,
    order: 30,
    sentToModel: true,
    cacheImpact: 'stable_until_strategy_changes',
  });

  assert.deepEqual(section, {
    id: 'active_execution_strategy',
    label: 'Active Strategy',
    target: 'system',
    lifecycle: 'pinned',
    source: 'strategy:async_teams',
    content,
    order: 30,
    sentToModel: true,
    cacheImpact: 'stable_until_strategy_changes',
    chars: content.length,
    metadata: {},
  });
});

test('appendSystemPromptSection appends text and records the section once', () => {
  const context = {
    systemPrompt: 'base',
    promptAssemblySections: [],
  };
  const section = createPromptSection({
    id: 'todo_guidelines',
    label: 'Todo Guidelines',
    target: 'system',
    lifecycle: 'pinned',
    source: 'feature:task_orchestration.todo_prompt',
    content: '<todo_mode_guidelines>Use todos.</todo_mode_guidelines>',
    order: 50,
  });

  appendSystemPromptSection(context, section);
  appendSystemPromptSection(context, section);

  assert.equal(
    context.systemPrompt,
    'base\n\n<todo_mode_guidelines>Use todos.</todo_mode_guidelines>',
  );
  assert.deepEqual(context.promptAssemblySections.map(item => item.id), ['todo_guidelines']);
});

test('composeSystemPromptSections builds AGENTS.md plus runtime context sections', () => {
  const result = composeSystemPromptSections({
    agentGuidance: 'You are helpful.',
    guidanceFile: 'guidance/02-bash/AGENTS.md',
    runtimeContext: '<runtime_context>today</runtime_context>',
  });

  assert.equal(
    result.text,
    'You are helpful.\n\n<runtime_context>today</runtime_context>',
  );
  assert.deepEqual(result.sections.map(section => ({
    id: section.id,
    target: section.target,
    source: section.source,
    order: section.order,
  })), [
    {
      id: 'agent_guidance',
      target: 'system',
      source: 'guidance/02-bash/AGENTS.md',
      order: 10,
    },
    {
      id: 'runtime_context',
      target: 'system',
      source: 'runtime',
      order: 20,
    },
  ]);
});

test('summarizePromptAssembly returns stable ordering and totals', () => {
  const sections = [
    createPromptSection({
      id: 'later',
      label: 'Later',
      target: 'system',
      lifecycle: 'pinned',
      source: 'test',
      content: 'bbbb',
      order: 20,
    }),
    createPromptSection({
      id: 'first',
      label: 'First',
      target: 'system',
      lifecycle: 'pinned',
      source: 'test',
      content: 'aa',
      order: 10,
    }),
  ];

  const summary = summarizePromptAssembly(sections);

  assert.deepEqual(summary.sections.map(section => section.id), ['first', 'later']);
  assert.equal(summary.totals.chars, 6);
  assert.equal(summary.totals.sentToModelChars, 6);
});
