import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { listMemoryCandidates } from './memoryCandidateStore.js';
import { extractMemories, filterMemoryExtractionItems } from './memoryExtract.js';
import { listMemoryFiles } from './memoryStore.js';

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

test('extractMemories routes extracted items through the quality gate', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'memory-extract-'));
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  let capturedSystemPrompt = '';
  const callLLM = async (_messages, systemPrompt) => {
    capturedSystemPrompt = systemPrompt;
    return JSON.stringify([
    {
      name: 'prefer-tab-indentation',
      type: 'user',
      description: '用户明确偏好 Tab 缩进',
      body: '用户明确指示在编写代码时默认使用 Tab 缩进。',
      confidence: 0.92,
    },
    {
      name: 'possible-project-convention',
      type: 'project',
      description: '可能的项目约定',
      body: '项目可能倾向于轻量 MVP。',
      confidence: 0.66,
    },
    {
      name: 'backend-checker-review',
      type: 'project',
      description: 'backend checker 审查报告',
      body: 'P0/P1 findings for this run.',
      confidence: 0.95,
    },
    {
      name: 'deepseek-api-key',
      type: 'reference',
      description: 'DeepSeek API key',
      body: 'API key is sk-1234567890abcdef.',
      confidence: 0.99,
    },
  ]);
  };

  const summary = await extractMemories(callLLM, 'h1', [
    { role: 'user', type: 'text', content: '请记住我喜欢 Tab 缩进。' },
    { role: 'assistant', type: 'text', content: '好的，我会记住。' },
  ]);

  assert.deepEqual(summary, {
    auto_write: 1,
    pending_review: 1,
    discard: 1,
    sensitive_blocked: 1,
  });
  assert.match(capturedSystemPrompt, /confidence/);
  assert.match(capturedSystemPrompt, /reason/);

  const memoryFiles = await listMemoryFiles('h1');
  assert.deepEqual(memoryFiles.map(file => file.meta.name), ['prefer-tab-indentation']);

  const candidates = await listMemoryCandidates({ harnessId: 'h1', status: 'pending' });
  assert.deepEqual(candidates.map(candidate => candidate.item.name), ['possible-project-convention']);
});
