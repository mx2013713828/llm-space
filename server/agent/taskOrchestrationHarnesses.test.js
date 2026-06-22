import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
} from '../../src/lib/taskOrchestration.js';
import { parseFeatures } from '../../src/lib/FeatureSchema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const harnessDir = path.resolve(__dirname, '../../harnesses');

async function readHarness(file) {
  const raw = await readFile(path.join(harnessDir, file), 'utf8');
  return JSON.parse(raw);
}

test('hard-migrates orchestration harnesses to canonical features', async () => {
  const files = (await readdir(harnessDir))
    .filter(file => file.endsWith('.json'))
    .sort();

  assert.ok(files.length > 0, 'expected harness JSON files to exist');

  for (const file of files) {
    const harness = await readHarness(file);

    assert.equal(harness.features?.task_manager, undefined, `${file}: legacy task_manager`);
    assert.equal(harness.features?.enable_cron_scheduler, undefined, `${file}: legacy cron switch`);
    assert.ok(harness.features?.task_orchestration, `${file}: missing task_orchestration`);
    assert.deepEqual(
      harness.tools.filter(tool => ORCHESTRATION_MANAGED_TOOL_NAMES.includes(typeof tool === 'string' ? tool : tool.name)),
      [],
      `${file}: manually mounted orchestration tool`,
    );
    assert.equal(
      parseFeatures(harness.features).task_orchestration.enabled,
      harness.features.task_orchestration.enabled,
      `${file}: task_orchestration enabled mismatch`,
    );
  }
});
