import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import readFile from './read_file.js';
import writeFile from './write_file.js';
import bash from './bash.js';
import { isBashSandboxAvailable } from './bashSandbox.js';
import { validateToolInput } from './toolValidation.js';

async function withTempWorkspace(fn) {
  const originalCwd = process.cwd();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-space-tools-'));
  const workspace = path.join(tempRoot, 'workspace');
  await fs.mkdir(workspace, { recursive: true });
  process.chdir(workspace);

  try {
    return await fn({ tempRoot, workspace });
  } finally {
    process.chdir(originalCwd);
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('rejects missing required string parameters', () => {
  assert.deepEqual(validateToolInput(readFile, {}), {
    ok: false,
    code: 'missing_required_parameter',
    message: 'read_file requires parameter "path".',
    details: { parameter: 'path', expectedType: 'string' },
  });
});

test('rejects invalid primitive parameter types', () => {
  assert.deepEqual(validateToolInput(readFile, { path: 42 }), {
    ok: false,
    code: 'invalid_parameter_type',
    message: 'read_file parameter "path" must be string.',
    details: { parameter: 'path', expectedType: 'string', actualType: 'number' },
  });
});

test('accepts valid required parameters', () => {
  assert.deepEqual(validateToolInput(readFile, { path: 'server.js' }), { ok: true });
});

test('read_file rejects path traversal outside the workspace', async () => {
  await withTempWorkspace(async ({ tempRoot }) => {
    await fs.writeFile(path.join(tempRoot, 'outside.txt'), 'outside secret', 'utf-8');

    const output = await readFile.execute({ path: '../outside.txt' });

    assert.match(output, /Access denied/i);
  });
});

test('read_file rejects sensitive workspace files', async () => {
  await withTempWorkspace(async ({ workspace }) => {
    await fs.writeFile(path.join(workspace, '.env'), 'API_KEY=secret', 'utf-8');

    const output = await readFile.execute({ path: '.env' });

    assert.match(output, /Access denied/i);
  });
});

test('write_file rejects path traversal outside the workspace', async () => {
  await withTempWorkspace(async ({ tempRoot }) => {
    const outsidePath = path.join(tempRoot, 'outside.txt');

    const output = await writeFile.execute({ path: '../outside.txt', content: 'leak' });

    assert.match(output, /Access denied/i);
    await assert.rejects(() => fs.readFile(outsidePath, 'utf-8'), /ENOENT/);
  });
});

test('write_file allows ordinary workspace scratch files', async () => {
  await withTempWorkspace(async ({ workspace }) => {
    const output = await writeFile.execute({
      path: '.agent-scratch/test.txt',
      content: 'ok',
    });

    assert.match(output, /Successfully wrote/);
    assert.equal(await fs.readFile(path.join(workspace, '.agent-scratch/test.txt'), 'utf-8'), 'ok');
  });
});

test('bash sandbox blocks obfuscated runtime reads of sensitive workspace files', async (t) => {
  if (!isBashSandboxAvailable()) {
    t.skip('process-level bash sandbox is only available when sandbox-exec exists');
    return;
  }

  await withTempWorkspace(async ({ workspace }) => {
    await fs.writeFile(path.join(workspace, '.env'), 'API_KEY=super-secret-from-env', 'utf-8');

    const script = "const fs=require('node:fs'); const p='.'+'env'; console.log(fs.readFileSync(p,'utf8'))";
    const output = await bash.execute({
      command: `"${process.execPath}" -e ${JSON.stringify(script)}`,
    });

    assert.doesNotMatch(output, /super-secret-from-env/);
    assert.match(output, /Operation not permitted|Permission denied|Access denied|not allowed/i);
  });
});
