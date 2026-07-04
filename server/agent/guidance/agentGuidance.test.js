import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
  AGENT_GUIDANCE_FILENAME,
  getAgentGuidancePath,
  loadAgentGuidance,
  saveAgentGuidance,
  stripLegacySystemPrompt,
} from './agentGuidance.js';

async function createRoot() {
  return mkdtemp(path.join(tmpdir(), 'agent-guidance-'));
}

test('loads guidance by initializing AGENTS.md from legacy system prompt', async () => {
  const guidanceRoot = await createRoot();

  const result = await loadAgentGuidance({
    harnessId: 'harness_1',
    fallbackContent: 'Legacy base prompt.',
    guidanceRoot,
  });

  assert.equal(result.content, 'Legacy base prompt.');
  assert.equal(result.filename, AGENT_GUIDANCE_FILENAME);
  assert.equal(result.source, 'initialized_from_legacy');
  assert.equal(result.file, 'guidance/harness_1/AGENTS.md');
  assert.equal(await readFile(result.absolutePath, 'utf-8'), 'Legacy base prompt.');
});

test('loads existing AGENTS.md instead of legacy system prompt', async () => {
  const guidanceRoot = await createRoot();
  await saveAgentGuidance({
    harnessId: 'harness_1',
    content: 'Current guidance.',
    guidanceRoot,
  });

  const result = await loadAgentGuidance({
    harnessId: 'harness_1',
    fallbackContent: 'Legacy base prompt.',
    guidanceRoot,
  });

  assert.equal(result.content, 'Current guidance.');
  assert.equal(result.source, 'file');
});

test('rejects unsafe harness ids for guidance paths', async () => {
  const guidanceRoot = await createRoot();

  assert.throws(
    () => getAgentGuidancePath({ harnessId: '../secret', guidanceRoot }),
    /Invalid harness ID/,
  );
  await assert.rejects(
    () => saveAgentGuidance({
      harnessId: 'bad/name',
      content: 'Nope',
      guidanceRoot,
    }),
    /Invalid harness ID/,
  );
});

test('stripLegacySystemPrompt removes JSON prompt while preserving other fields', () => {
  const result = stripLegacySystemPrompt({
    id: 'harness_1',
    name: 'Harness',
    systemPrompt: 'Legacy base prompt.',
    features: { enable_memory: { enabled: true } },
  });

  assert.deepEqual(result, {
    id: 'harness_1',
    name: 'Harness',
    features: { enable_memory: { enabled: true } },
  });
});
