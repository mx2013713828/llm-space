import { listMcpServers } from './mcpConfigStore.js';
import { McpClient } from './mcpClient.js';
import { normalizeMcpName, parseMcpToolName } from './mcpNames.js';
import { adaptMcpTools } from './mcpToolAdapter.js';

function formatMcpToolResult(result) {
	if (Array.isArray(result?.content)) {
		return result.content.map(item => {
			if (item?.type === 'text') return item.text || '';
			return JSON.stringify(item);
		}).join('\n');
	}
	if (result?.structuredContent !== undefined) {
		return JSON.stringify(result.structuredContent, null, 2);
	}
	return JSON.stringify(result ?? {}, null, 2);
}

export class McpManager {
	constructor({ rootDir = process.cwd(), servers = null, fetchImpl = fetch, ClientClass = McpClient } = {}) {
		this.rootDir = rootDir;
		this.initialServers = servers;
		this.fetchImpl = fetchImpl;
		this.ClientClass = ClientClass;
		this.clients = new Map();
		this.toolCache = new Map();
		this.status = new Map();
	}

	async listConfiguredServers() {
		if (Array.isArray(this.initialServers)) return this.initialServers;
		return listMcpServers({ rootDir: this.rootDir });
	}

	async getServer(serverId) {
		const id = normalizeMcpName(serverId);
		const servers = await this.listConfiguredServers();
		return servers.find(server => server.id === id) || null;
	}

	async connectServer(serverId) {
		const server = await this.getServer(serverId);
		if (!server) throw new Error(`Unknown MCP server: ${serverId}`);
		let client = this.clients.get(server.id);
		if (!client) {
			client = new this.ClientClass({ server, fetchImpl: this.fetchImpl });
			this.clients.set(server.id, client);
		}
		const status = await client.connect();
		const tools = await client.listTools();
		this.toolCache.set(server.id, tools);
		const nextStatus = {
			...status,
			server,
			status: 'connected',
			tools,
			toolDefinitions: adaptMcpTools({ server, tools }),
			lastError: '',
		};
		this.status.set(server.id, nextStatus);
		return nextStatus;
	}

	async refreshTools(serverId) {
		return this.connectServer(serverId);
	}

	async getServerStatus(serverId) {
		const id = normalizeMcpName(serverId);
		if (this.status.has(id)) return this.status.get(id);
		const server = await this.getServer(id);
		return {
			serverId: id,
			server,
			status: 'disconnected',
			tools: [],
			toolDefinitions: [],
			lastError: '',
		};
	}

	async getMountedToolDefinitions(mount = {}) {
		if (!mount?.enabled) return [];
		const mountedServers = Array.isArray(mount.mountedServers) ? mount.mountedServers : [];
		const definitions = [];
		for (const serverId of mountedServers) {
			const id = normalizeMcpName(serverId);
			let status = this.status.get(id);
			if (!status) {
				status = await this.connectServer(id);
			}
			const allowlist = mount.toolAllowlist?.[id];
			const allowed = Array.isArray(allowlist) && allowlist.length > 0 ? new Set(allowlist) : null;
			for (const definition of status.toolDefinitions || []) {
				if (allowed && !allowed.has(definition.mcp.toolName)) continue;
				definitions.push(definition);
			}
		}
		return definitions;
	}

	async callTool(toolName, input = {}) {
		const parsed = parseMcpToolName(toolName);
		if (!parsed) throw new Error(`Not an MCP tool: ${toolName}`);
		const status = await this.connectServer(parsed.serverId);
		const result = await this.clients.get(status.server.id).callTool(parsed.toolName, input);
		return formatMcpToolResult(result);
	}

	async disconnectAll() {
		await Promise.all([...this.clients.values()].map(client => client.disconnect()));
		this.clients.clear();
		this.status.clear();
	}
}

export const defaultMcpManager = new McpManager();
