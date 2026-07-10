import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { loadMcpMount, saveMcpMount } from './mcpMountStore.js';

async function withTempDir(fn) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'llm-space-mcp-mount-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test('returns disabled empty mount by default', async () => {
	await withTempDir(async (rootDir) => {
		assert.deepEqual(await loadMcpMount({ rootDir, harnessId: 'h1' }), {
			enabled: false,
			mountedServers: [],
			toolAllowlist: {},
			approvalMode: 'auto_readonly',
		});
	});
});

test('saves and reloads normalized harness MCP mount', async () => {
	await withTempDir(async (rootDir) => {
		const saved = await saveMcpMount({
			rootDir,
			harnessId: 'h1',
			mount: {
				enabled: true,
				mountedServers: ['Context 7'],
				toolAllowlist: { 'Context 7': ['get-library-docs'] },
				approvalMode: 'ask_all',
			},
		});
		assert.deepEqual(saved, {
			enabled: true,
			mountedServers: ['context_7'],
			toolAllowlist: { context_7: ['get-library-docs'] },
			approvalMode: 'ask_all',
		});
		assert.deepEqual(await loadMcpMount({ rootDir, harnessId: 'h1' }), saved);
	});
});
