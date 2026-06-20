import test from 'node:test';
import assert from 'node:assert/strict';

import {
  composeSystemPrompt,
  formatRuntimeContext,
  getRuntimeMetadata,
} from './runtimeContext.js';

test('builds metadata using the requested timezone and runtime values', () => {
  const metadata = getRuntimeMetadata({
    now: new Date('2026-06-19T16:30:00.000Z'),
    timeZone: 'Asia/Shanghai',
    platform: 'darwin',
    arch: 'arm64',
    cwd: '/workspace/project',
  });

  assert.deepEqual(metadata, {
    date: '2026-06-20',
    timezone: 'Asia/Shanghai',
    operatingSystem: 'macOS',
    architecture: 'arm64',
    workingDirectory: '/workspace/project',
  });
});

test('maps known platforms and preserves unknown platform names', () => {
  const base = {
    now: new Date('2026-06-20T00:00:00.000Z'),
    timeZone: 'UTC',
    arch: 'x64',
    cwd: '/workspace',
  };

  assert.equal(getRuntimeMetadata({ ...base, platform: 'linux' }).operatingSystem, 'Linux');
  assert.equal(getRuntimeMetadata({ ...base, platform: 'win32' }).operatingSystem, 'Windows');
  assert.equal(getRuntimeMetadata({ ...base, platform: 'freebsd' }).operatingSystem, 'freebsd');
});

test('formats metadata as escaped XML', () => {
  const block = formatRuntimeContext({
    date: '2026-06-20',
    timezone: 'Etc/<UTC>',
    operatingSystem: 'Test & OS',
    architecture: 'arm64',
    workingDirectory: '/tmp/a & b',
  });

  assert.equal(block, [
    '<runtime_context>',
    '  <date>2026-06-20</date>',
    '  <timezone>Etc/&lt;UTC&gt;</timezone>',
    '  <operating_system>Test &amp; OS</operating_system>',
    '  <architecture>arm64</architecture>',
    '  <working_directory>/tmp/a &amp; b</working_directory>',
    '</runtime_context>',
  ].join('\n'));
});

test('composes runtime context with empty and non-empty system prompts', () => {
  const runtimeContext = '<runtime_context>test</runtime_context>';

  assert.equal(composeSystemPrompt('', runtimeContext), runtimeContext);
  assert.equal(
    composeSystemPrompt('You are a coding assistant.', runtimeContext),
    `You are a coding assistant.\n\n${runtimeContext}`,
  );
});
