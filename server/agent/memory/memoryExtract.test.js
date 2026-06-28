import test from 'node:test';
import assert from 'node:assert/strict';

import { filterMemoryExtractionItems } from './memoryExtract.js';

test('filters transient teammate and review-report memory items', () => {
  const items = filterMemoryExtractionItems([
    {
      name: 'backend-checker-execution-strategy-review',
      type: 'project',
      description: 'backend checker 审查报告',
      body: 'P0/P1 findings for this run.',
    },
    {
      name: 'prefer-tab-indentation',
      type: 'user',
      description: '用户偏好 Tab 缩进',
      body: '用户明确偏好使用 Tab 缩进。',
    },
  ]);

  assert.deepEqual(items.map(item => item.name), ['prefer-tab-indentation']);
});

test('caps extracted memories per run', () => {
  const items = filterMemoryExtractionItems([
    { name: 'stable-one', type: 'project', description: 'stable one', body: 'one' },
    { name: 'stable-two', type: 'project', description: 'stable two', body: 'two' },
    { name: 'stable-three', type: 'project', description: 'stable three', body: 'three' },
  ]);

  assert.deepEqual(items.map(item => item.name), ['stable-one', 'stable-two']);
});
