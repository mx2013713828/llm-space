import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { loadTeammateTrace, saveTeammateTrace } from './teammateTraceStore.js';

test('saves and loads teammate traces with summary metadata', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'teammate-trace-'));
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const traceRef = await saveTeammateTrace({
    harnessId: 'h1',
    teamId: 'team_1',
    teammateId: 'teammate_reviewer',
    name: 'Reviewer',
    role: 'Critic',
    prompt: 'Review the patch.',
    messages: [
      { role: 'assistant', type: 'thinking', content: 'Inspecting.' },
      { role: 'assistant', type: 'tool_call', toolName: 'read_file', toolOutput: 'source' },
      { role: 'assistant', type: 'text', content: 'Looks good.' },
    ],
    finalAnswer: 'Looks good.',
    status: 'completed',
    startedAt: '2026-06-28T00:00:00.000Z',
    completedAt: '2026-06-28T00:00:03.000Z',
  });

  assert.equal(traceRef.traceId, 'team_1_teammate_reviewer');
  assert.equal(traceRef.summary.messageCount, 3);
  assert.equal(traceRef.summary.toolCallCount, 1);
  assert.deepEqual(traceRef.summary.toolNames, ['read_file']);

  const trace = await loadTeammateTrace('h1', 'team_1', 'teammate_reviewer');
  assert.equal(trace.schema, 'llm-space.teammate_trace.v1');
  assert.equal(trace.teamId, 'team_1');
  assert.equal(trace.teammateId, 'teammate_reviewer');
  assert.equal(trace.finalAnswer, 'Looks good.');
  assert.equal(trace.messages.length, 3);
});
