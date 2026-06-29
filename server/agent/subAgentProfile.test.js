import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSubAgentProfile,
  createSubAgentFeatures,
  getLastAssistantText,
  selectSubAgentTools,
} from './subAgentProfile.js';

test('createSubAgentFeatures deep-clones parent settings and disables orchestration and memory', () => {
  const parentFeatures = {
    task_orchestration: {
      enabled: true,
      mode: 'task_system',
      enable_sub_agents: true,
      enable_background_tasks: true,
    },
    enable_memory: {
      enabled: true,
      provider: 'local',
    },
    security_mode: 'strict',
    enable_skills: true,
    context_compaction: {
      enabled: true,
      output_offload: true,
    },
    error_recovery: {
      enabled: true,
      max_retries: 2,
    },
  };

  const childFeatures = createSubAgentFeatures(parentFeatures);

  assert.notEqual(childFeatures, parentFeatures);
  assert.notEqual(childFeatures.task_orchestration, parentFeatures.task_orchestration);
  assert.notEqual(childFeatures.enable_memory, parentFeatures.enable_memory);
  assert.equal(childFeatures.task_orchestration.enabled, false);
  assert.equal(childFeatures.enable_memory.enabled, false);
  assert.equal(childFeatures.security_mode, 'strict');
  assert.equal(childFeatures.enable_skills, true);
  assert.deepEqual(childFeatures.context_compaction, {
    enabled: true,
    output_offload: true,
  });
  assert.deepEqual(childFeatures.error_recovery, {
    enabled: true,
    max_retries: 2,
  });
  assert.equal(parentFeatures.task_orchestration.enabled, true);
  assert.equal(parentFeatures.enable_memory.enabled, true);
});

test('selectSubAgentTools removes every orchestration-managed tool by normalized name', () => {
  const selectedTools = selectSubAgentTools([
    'bash',
    'sub_agent',
    { name: 'schedule_cron', description: 'cron scheduler' },
    { name: 'query_background_tasks' },
    { name: 'write_todos' },
    { name: 'custom_tool', description: 'kept' },
  ]);

  assert.deepEqual(selectedTools, ['bash', { name: 'custom_tool', description: 'kept' }]);
});

test('createSubAgentProfile returns executor-ready child profile data', () => {
  const parentExecutor = {
    harnessId: 'h1',
    tools: ['bash', 'sub_agent', { name: 'custom_tool' }],
    features: {
      task_orchestration: {
        enabled: true,
        enable_sub_agents: true,
      },
      enable_memory: {
        enabled: true,
      },
    },
  };

  const profile = createSubAgentProfile({
    parentExecutor,
    prompt: 'Inspect the code.',
    childId: 'tool_123',
  });

  assert.equal(profile.identity.childType, 'sub_agent');
  assert.equal(profile.identity.childId, 'tool_123');
  assert.equal(profile.identity.parentHarnessId, 'h1');
  assert.deepEqual(profile.messages, [{ role: 'user', content: 'Inspect the code.' }]);
  assert.match(profile.systemPrompt, /one-off sub-agent/i);
  assert.deepEqual(profile.tools, ['bash', { name: 'custom_tool' }]);
  assert.equal(profile.features.task_orchestration.enabled, false);
  assert.equal(profile.features.task_orchestration.enable_sub_agents, false);
  assert.equal(profile.features.enable_memory.enabled, false);
});

test('getLastAssistantText returns only the final non-empty assistant text block', () => {
  const text = getLastAssistantText([
    { role: 'assistant', type: 'text', content: '' },
    { role: 'assistant', type: 'thinking', content: 'draft' },
    { role: 'assistant', type: 'text', content: '   ' },
    { role: 'user', type: 'text', content: 'ignore me' },
    { role: 'assistant', type: 'text', content: 'Final answer' },
    { role: 'assistant', type: 'tool_call', content: 'still ignore me' },
  ]);

  assert.equal(text, 'Final answer');
});

test('getLastAssistantText returns null when no non-empty assistant text exists', () => {
  const text = getLastAssistantText([
    { role: 'assistant', type: 'text', content: ' ' },
    { role: 'assistant', type: 'thinking', content: 'draft' },
    { role: 'user', type: 'text', content: 'hello' },
  ]);

  assert.equal(text, null);
});
