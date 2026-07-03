import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyMemoryItem, summarizeMemoryRouting } from './memoryQualityGate.js';

test('classifyMemoryItem auto-writes explicit user preferences', () => {
  const result = classifyMemoryItem({
    name: 'prefer-tab-indentation',
    type: 'user',
    description: '用户明确偏好 Tab 缩进',
    body: '用户明确指示在编写代码时默认使用 Tab 缩进。',
    confidence: 0.92,
  }, {
    explicitMemoryRequest: true,
    source: { kind: 'conversation' },
  });

  assert.equal(result.decision, 'auto_write');
  assert.equal(result.risk, 'low');
  assert.ok(result.confidence >= 0.9);
  assert.match(result.reason, /explicit/i);
});

test('classifyMemoryItem discards transient teammate and review outputs', () => {
  const result = classifyMemoryItem({
    name: 'backend-checker-execution-strategy-review',
    type: 'project',
    description: 'backend checker 审查报告',
    body: 'P0/P1 findings for this run.',
    confidence: 0.95,
  }, {
    source: { kind: 'teammate', agentId: 'backend-checker' },
  });

  assert.equal(result.decision, 'discard');
  assert.equal(result.risk, 'transient');
  assert.match(result.reason, /transient/i);
});

test('classifyMemoryItem blocks sensitive credentials', () => {
  const result = classifyMemoryItem({
    name: 'deepseek-api-key',
    type: 'reference',
    description: 'DeepSeek API key',
    body: 'API key is sk-1234567890abcdef.',
    confidence: 0.99,
  });

  assert.equal(result.decision, 'sensitive_blocked');
  assert.equal(result.risk, 'sensitive');
  assert.match(result.reason, /sensitive/i);
});

test('classifyMemoryItem queues ambiguous useful memories for review', () => {
  const result = classifyMemoryItem({
    name: 'possible-project-convention',
    type: 'project',
    description: '可能的项目约定',
    body: '项目可能倾向于使用轻量 MVP 实现。',
    confidence: 0.66,
  }, {
    source: { kind: 'conversation' },
  });

  assert.equal(result.decision, 'pending_review');
  assert.equal(result.risk, 'medium');
  assert.match(result.reason, /review/i);
});

test('summarizeMemoryRouting counts decisions for observability', () => {
  const summary = summarizeMemoryRouting([
    { decision: 'auto_write' },
    { decision: 'pending_review' },
    { decision: 'pending_review' },
    { decision: 'discard' },
    { decision: 'sensitive_blocked' },
  ]);

  assert.deepEqual(summary, {
    auto_write: 1,
    pending_review: 2,
    discard: 1,
    sensitive_blocked: 1,
  });
});
