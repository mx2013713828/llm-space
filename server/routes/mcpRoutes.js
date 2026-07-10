import { McpManager, defaultMcpManager } from '../mcp/mcpManager.js';
import {
	deleteMcpServer,
	getMcpPresets,
	listMcpServers,
	upsertMcpServer,
} from '../mcp/mcpConfigStore.js';
import {
	loadMcpMount,
	saveMcpMount,
} from '../mcp/mcpMountStore.js';
import { normalizeMcpName } from '../mcp/mcpNames.js';

function sanitizeStatus(status) {
	return {
		serverId: status.serverId || status.server?.id || '',
		status: status.status || 'disconnected',
		serverInfo: status.serverInfo || null,
		instructions: status.instructions || '',
		lastError: status.lastError || '',
		tools: (status.tools || []).map(tool => ({
			name: tool.name,
			description: tool.description || '',
			inputSchema: tool.inputSchema || tool.input_schema || {},
			annotations: tool.annotations || {},
		})),
		toolDefinitions: status.toolDefinitions || [],
	};
}

export function registerMcpRoutes(app, {
	rootDir = process.cwd(),
	mcpManager = null,
} = {}) {
	const manager = mcpManager || new McpManager({ rootDir });

	app.get('/api/mcp/presets', (_req, res) => {
		res.json(getMcpPresets());
	});

	app.get('/api/mcp/servers', async (_req, res) => {
		try {
			const servers = await listMcpServers({ rootDir });
			const statuses = {};
			for (const server of servers) {
				statuses[server.id] = sanitizeStatus(await manager.getServerStatus(server.id));
			}
			res.json({ servers, statuses });
		} catch (err) {
			res.status(500).json({ error: err.message });
		}
	});

	app.post('/api/mcp/servers', async (req, res) => {
		try {
			const server = await upsertMcpServer({ rootDir, server: req.body || {} });
			if (manager.initialServers) manager.initialServers = null;
			res.json(server);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.patch('/api/mcp/servers/:serverId', async (req, res) => {
		try {
			const existing = (await listMcpServers({ rootDir }))
				.find(server => server.id === normalizeMcpName(req.params.serverId));
			if (!existing) return res.status(404).json({ error: 'MCP server not found' });
			res.json(await upsertMcpServer({ rootDir, server: { ...existing, ...(req.body || {}) } }));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.delete('/api/mcp/servers/:serverId', async (req, res) => {
		try {
			await deleteMcpServer({ rootDir, serverId: req.params.serverId });
			res.json({ success: true });
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/mcp/servers/:serverId/connect', async (req, res) => {
		try {
			res.json(sanitizeStatus(await manager.connectServer(req.params.serverId)));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/mcp/servers/:serverId/refresh-tools', async (req, res) => {
		try {
			res.json(sanitizeStatus(await manager.refreshTools(req.params.serverId)));
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/mcp/servers/:serverId/test-tool', async (req, res) => {
		try {
			const serverId = normalizeMcpName(req.params.serverId);
			const toolName = req.body?.toolName;
			const output = await manager.callTool(`mcp__${serverId}__${toolName}`, req.body?.arguments || {});
			res.json({ output });
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.get('/api/harnesses/:harnessId/mcp', async (req, res) => {
		try {
			const mount = await loadMcpMount({ rootDir, harnessId: req.params.harnessId });
			const toolDefinitions = await manager.getMountedToolDefinitions(mount);
			res.json({ mount, toolDefinitions });
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});

	app.post('/api/harnesses/:harnessId/mcp', async (req, res) => {
		try {
			const mount = await saveMcpMount({
				rootDir,
				harnessId: req.params.harnessId,
				mount: req.body || {},
			});
			res.json(mount);
		} catch (err) {
			res.status(400).json({ error: err.message });
		}
	});
}

export { defaultMcpManager };
