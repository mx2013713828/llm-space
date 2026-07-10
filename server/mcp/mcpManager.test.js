import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { McpManager } from './mcpManager.js';

async function withTempDir(fn) {
	const dir = await mkdtemp(path.join(os.tmpdir(), 'llm-space-mcp-manager-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test('connects to a stdio MCP server, lists tools, and calls a tool', async () => {
	await withTempDir(async (rootDir) => {
		const serverPath = path.resolve('examples/mcp/echo-server.js');
		const manager = new McpManager({
			rootDir,
			servers: [{
				id: 'echo',
				name: 'Echo',
				transport: 'stdio',
				command: process.execPath,
				args: [serverPath],
				cwd: process.cwd(),
				enabled: true,
			}],
		});

		const status = await manager.connectServer('echo');
		assert.equal(status.status, 'connected');
		assert.equal(status.tools.length, 1);
		assert.equal(status.tools[0].name, 'echo');

		const result = await manager.callTool('mcp__echo__echo', { text: 'hello' });
		assert.match(result, /hello/);

		await manager.disconnectAll();
	});
});

test('returns mounted MCP tools for a harness mount', async () => {
	const manager = new McpManager({
		servers: [{
			id: 'echo',
			name: 'Echo',
			transport: 'stdio',
			command: process.execPath,
			args: [path.resolve('examples/mcp/echo-server.js')],
			cwd: process.cwd(),
			enabled: true,
		}],
	});
	try {
		await manager.connectServer('echo');
		const tools = await manager.getMountedToolDefinitions({
			enabled: true,
			mountedServers: ['echo'],
			toolAllowlist: { echo: ['echo'] },
		});
		assert.equal(tools.length, 1);
		assert.equal(tools[0].name, 'mcp__echo__echo');
	} finally {
		await manager.disconnectAll();
	}
});
