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

test('tracks lifecycle and bounded call history for a managed server', async () => {
	const manager = new McpManager({
		servers: [{
			id: 'echo', name: 'Echo', transport: 'stdio', command: process.execPath,
			args: [path.resolve('examples/mcp/echo-server.js')], cwd: process.cwd(), enabled: true,
		}],
	});
	try {
		assert.equal((await manager.getServerStatus('echo')).status, 'stopped');
		await manager.connectServer('echo');
		assert.equal((await manager.getServerStatus('echo')).status, 'connected');
		assert.equal((await manager.getServerStatus('echo')).auth.status, 'anonymous');
		await manager.callTool('mcp__echo__echo', { text: 'history' });
		assert.equal((await manager.getServerStatus('echo')).auth.status, 'verified');
		assert.equal((await manager.listCallSummaries('echo')).length, 1);
		await manager.disconnectServer('echo');
		assert.equal((await manager.getServerStatus('echo')).status, 'stopped');
	} finally {
		await manager.disconnectAll();
	}
});

test('records structured connection errors and authentication failures', async () => {
	class FailingClient {
		constructor() { this.diagnostic = 'remote rejected bearer credential'; }
		async connect() { throw new Error('MCP HTTP 401: invalid key'); }
		async disconnect() {}
	}
	const manager = new McpManager({
		ClientClass: FailingClient,
		servers: [{ id: 'remote', name: 'Remote', transport: 'streamable_http', url: 'https://example.test/mcp', headers: { Authorization: { source: 'bearer', value: 'secret' } } }],
	});
	await assert.rejects(() => manager.connectServer('remote'), /401/);
	const status = await manager.getServerStatus('remote');
	assert.equal(status.status, 'error');
	assert.equal(status.error.code, 'authentication_failed');
	assert.equal(status.auth.status, 'invalid');
	assert.doesNotMatch(status.diagnostic, /secret/);
});
