import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildBashEnvironment,
  buildBashSpawnInvocation,
  formatBashSandboxNotice,
} from './bashSandbox.js';

async function withTempWorkspace(fn) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'llm-space-bash-sandbox-'));
  try {
    await fs.writeFile(path.join(tempRoot, '.env'), 'SECRET_TOKEN=hidden', 'utf8');
    return await fn(tempRoot);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

test('uses sandbox-exec on macOS when process sandboxing is available', async () => {
  await withTempWorkspace(async (rootDir) => {
    const invocation = buildBashSpawnInvocation('echo ok', {
      rootDir,
      platform: 'darwin',
      sandboxAvailable: true,
      sandboxExecPath: '/custom/sandbox-exec',
      disableSandbox: false,
    });

    assert.equal(invocation.command, '/custom/sandbox-exec');
    assert.equal(invocation.sandboxed, true);
    assert.equal(invocation.redactionOnly, false);
    assert.match(invocation.reason, /sandbox-exec/i);
  });
});

test('reports redaction-only mode on platforms without process sandboxing', async () => {
  await withTempWorkspace(async (rootDir) => {
    const invocation = buildBashSpawnInvocation('echo ok', {
      rootDir,
      platform: 'linux',
      sandboxAvailable: false,
      disableSandbox: false,
    });

    assert.equal(invocation.command, 'bash');
    assert.equal(invocation.sandboxed, false);
    assert.equal(invocation.redactionOnly, true);
    assert.match(invocation.reason, /unavailable/i);
  });
});

test('formats a user-visible degraded sandbox notice', () => {
  const notice = formatBashSandboxNotice({
    sandboxed: false,
    redactionOnly: true,
    reason: 'process-level sandbox unavailable on linux',
  });

  assert.match(notice, /SECURITY NOTICE/);
  assert.match(notice, /redaction/i);
  assert.match(notice, /linux/i);
});

test('builds a bash environment without leaking model or tool secrets', () => {
  const env = buildBashEnvironment({
    PATH: '/usr/bin',
    HOME: '/Users/tester',
    USER: 'tester',
    MODELS_CONFIG: '[{"key":"secret"}]',
    TAVILY_API_KEY: 'secret',
    API_KEY: 'secret',
    HTTP_PROXY: 'http://proxy-with-credentials',
    FORCE_COLOR: '0',
  });

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/Users/tester');
  assert.equal(env.USER, 'tester');
  assert.equal(env.FORCE_COLOR, '1');
  assert.equal(env.PYTHONUNBUFFERED, '1');
  assert.equal(env.PIP_PROGRESS_BAR, 'on');
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal('MODELS_CONFIG' in env, false);
  assert.equal('TAVILY_API_KEY' in env, false);
  assert.equal('API_KEY' in env, false);
  assert.equal('HTTP_PROXY' in env, false);
});
