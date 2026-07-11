import { listMcpServers } from './mcpConfigStore.js';
import { McpClient } from './mcpClient.js';
import { normalizeMcpName, parseMcpToolName } from './mcpNames.js';
import { adaptMcpTools } from './mcpToolAdapter.js';
import { McpRuntimeLog } from './mcpRuntimeLog.js';

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
	constructor({ rootDir = process.cwd(), servers = null, fetchImpl = fetch, ClientClass = McpClient, runtimeLog = new McpRuntimeLog() } = {}) {
		this.rootDir = rootDir;
		this.initialServers = servers;
		this.fetchImpl = fetchImpl;
		this.ClientClass = ClientClass;
		this.clients = new Map();
		this.toolCache = new Map();
		this.status = new Map();
		this.runtimeLog = runtimeLog;
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
		this.status.set(server.id, { ...(await this.getServerStatus(server.id)), server, status: 'starting', lastError: '', diagnostic: '' });
		let client = this.clients.get(server.id);
		if (!client) {
			client = new this.ClientClass({ server, fetchImpl: this.fetchImpl });
			this.clients.set(server.id, client);
		}
		try {
			const status = await client.connect();
			const tools = await client.listTools();
			this.toolCache.set(server.id, tools);
			const nextStatus = {
				...status, server, status: 'connected', connectedAt: new Date().toISOString(),
				tools, toolDefinitions: adaptMcpTools({ server, tools }), lastError: '', diagnostic: '',
			};
			this.status.set(server.id, nextStatus);
			return nextStatus;
		} catch (err) {
			this.status.set(server.id, {
				...(await this.getServerStatus(server.id)), server, status: 'error',
				lastError: String(err.message || err), diagnostic: '',
			});
			throw err;
		}
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
			status: 'stopped',
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
		const startedAt = Date.now();
		try {
			const status = await this.connectServer(parsed.serverId);
			const result = await this.clients.get(status.server.id).callTool(parsed.toolName, input);
			const output = formatMcpToolResult(result);
			this.runtimeLog.record({ serverId: parsed.serverId, toolName: parsed.toolName, argumentKeys: Object.keys(input || {}), output, durationMs: Date.now() - startedAt });
			return output;
		} catch (err) {
			this.runtimeLog.record({ serverId: parsed.serverId, toolName: parsed.toolName, argumentKeys: Object.keys(input || {}), error: String(err.message || err), durationMs: Date.now() - startedAt });
			throw err;
		}
	}

	async listCallSummaries(serverId, options) { return this.runtimeLog.list(normalizeMcpName(serverId), options); }
	async getCallDetail(serverId, callId) { return this.runtimeLog.get(normalizeMcpName(serverId), callId); }

	async disconnectServer(serverId) {
		const id = normalizeMcpName(serverId);
		const client = this.clients.get(id);
		if (client) await client.disconnect();
		this.clients.delete(id);
		const previous = await this.getServerStatus(id);
		const next = { ...previous, status: 'stopped', connectedAt: null, lastError: '', diagnostic: '' };
		this.status.set(id, next);
		return next;
	}

	async disconnectAll() {
		await Promise.all([...this.clients.values()].map(client => client.disconnect()));
		this.clients.clear();
		this.status.clear();
	}
}

export const defaultMcpManager = new McpManager();
