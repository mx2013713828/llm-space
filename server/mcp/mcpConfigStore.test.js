import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
	getMcpPresets,
	listMcpServers,
	saveMcpServers,
	upsertMcpServer,
} from './mcpConfigStore.js';

async function withTempDir(fn) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'llm-space-mcp-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test('lists empty MCP config when no server file exists', async () => {
	await withTempDir(async (rootDir) => {
		assert.deepEqual(await listMcpServers({ rootDir }), []);
	});
});

test('saves and reloads normalized MCP stdio server config', async () => {
	await withTempDir(async (rootDir) => {
		await saveMcpServers({
			rootDir,
			servers: [{
				name: 'My Local MCP',
				transport: 'stdio',
				command: 'node',
				args: ['./server.js'],
				cwd: '.',
				enabled: true,
			}],
		});

		const servers = await listMcpServers({ rootDir });
		assert.equal(servers.length, 1);
		assert.equal(servers[0].id, 'my_local_mcp');
		assert.equal(servers[0].transport, 'stdio');
		assert.deepEqual(servers[0].args, ['./server.js']);

		const raw = JSON.parse(await readFile(path.join(rootDir, '.mcp', 'servers.json'), 'utf-8'));
		assert.equal(raw.servers[0].id, 'my_local_mcp');
	});
});

test('upserts streamable HTTP server config', async () => {
	await withTempDir(async (rootDir) => {
		const saved = await upsertMcpServer({
			rootDir,
			server: {
				id: 'remote-docs',
				name: 'Remote Docs',
				transport: 'streamable_http',
				url: 'https://example.test/mcp',
				auth: { type: 'bearer', env: 'REMOTE_MCP_TOKEN' },
			},
		});

		assert.equal(saved.id, 'remote-docs');
		const servers = await listMcpServers({ rootDir });
		assert.equal(servers[0].url, 'https://example.test/mcp');
		assert.equal(servers[0].auth.env, 'REMOTE_MCP_TOKEN');
	});
});

test('includes Context7 preset', () => {
	const presets = getMcpPresets();
	const context7 = presets.find(preset => preset.id === 'context7');
	assert.ok(context7);
	assert.equal(context7.transport, 'stdio');
	assert.equal(context7.command, 'npx');
	assert.deepEqual(context7.args, ['-y', '@upstash/context7-mcp']);
});
