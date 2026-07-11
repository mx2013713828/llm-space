import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { registerMcpRoutes } from './mcpRoutes.js';
import { createRouteApp, dispatchJson } from './routeTestUtils.js';
import { McpManager } from '../mcp/mcpManager.js';

async function createFixture(t) {
	const rootDir = await mkdtemp(path.join(os.tmpdir(), 'mcp-routes-'));
	t.after(async () => {
		await rm(rootDir, { recursive: true, force: true });
	});
	return { rootDir };
}

test('MCP routes create, connect, test, mount, and list servers', async (t) => {
	const { rootDir } = await createFixture(t);
	const app = createRouteApp();
	const mcpManager = new McpManager({ rootDir });
	t.after(async () => {
		await mcpManager.disconnectAll();
	});
	registerMcpRoutes(app, { rootDir, mcpManager });

	const presetsRes = await dispatchJson(app, 'GET', '/api/mcp/presets');
	assert.equal(presetsRes.status, 200);
	assert.ok(presetsRes.body.find(preset => preset.id === 'context7'));

	const createRes = await dispatchJson(app, 'POST', '/api/mcp/servers', {
		body: {
			id: 'echo',
			name: 'Echo',
			transport: 'stdio',
			command: process.execPath,
			args: [path.resolve('examples/mcp/echo-server.js')],
			cwd: process.cwd(),
			enabled: true,
		},
	});
	assert.equal(createRes.status, 200);
	assert.equal(createRes.body.id, 'echo');

	const connectRes = await dispatchJson(app, 'POST', '/api/mcp/servers/echo/connect');
	assert.equal(connectRes.status, 200);
	assert.equal(connectRes.body.status, 'connected');
	assert.equal(connectRes.body.tools[0].name, 'echo');

	const statusRes = await dispatchJson(app, 'GET', '/api/mcp/servers/echo/status');
	assert.equal(statusRes.status, 200);
	assert.equal(statusRes.body.status, 'connected');
	assert.equal(statusRes.body.auth.status, 'anonymous');

	const testRes = await dispatchJson(app, 'POST', '/api/mcp/servers/echo/test-tool', {
		body: { toolName: 'echo', arguments: { text: 'route' } },
	});
	assert.equal(testRes.status, 200);
	assert.match(testRes.body.output, /route/);

	const callsRes = await dispatchJson(app, 'GET', '/api/mcp/servers/echo/calls');
	assert.equal(callsRes.status, 200);
	assert.equal(callsRes.body.calls.length, 1);
	assert.deepEqual(callsRes.body.calls[0].argumentKeys, ['text']);

	const detailRes = await dispatchJson(app, 'GET', `/api/mcp/servers/echo/calls/${callsRes.body.calls[0].id}`);
	assert.equal(detailRes.status, 200);
	assert.equal(detailRes.body.toolName, 'echo');

	const disconnectRes = await dispatchJson(app, 'POST', '/api/mcp/servers/echo/disconnect');
	assert.equal(disconnectRes.status, 200);
	assert.equal(disconnectRes.body.status, 'stopped');

	const mountRes = await dispatchJson(app, 'POST', '/api/harnesses/h1/mcp', {
		body: {
			enabled: true,
			mountedServers: ['echo'],
			toolAllowlist: { echo: ['echo'] },
		},
	});
	assert.equal(mountRes.status, 200);
	assert.deepEqual(mountRes.body.mountedServers, ['echo']);

	const mountedRes = await dispatchJson(app, 'GET', '/api/harnesses/h1/mcp');
	assert.equal(mountedRes.status, 200);
	assert.equal(mountedRes.body.mount.enabled, true);
	assert.equal(mountedRes.body.toolDefinitions[0].name, 'mcp__echo__echo');

	const listRes = await dispatchJson(app, 'GET', '/api/mcp/servers');
	assert.equal(listRes.status, 200);
	assert.equal(listRes.body.servers[0].id, 'echo');
});
