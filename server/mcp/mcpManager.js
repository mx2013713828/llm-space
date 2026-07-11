import { listMcpServers } from './mcpConfigStore.js';
import { McpClient, classifyMcpError, resolveMcpValue } from './mcpClient.js';
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

function configuredValues(server = {}) {
	const values = [];
	for (const entry of Object.values(server.env || {})) {
		const resolved = resolveMcpValue(entry);
		if (resolved?.value) values.push(resolved.value.replace(/^Bearer\s+/i, ''));
	}
	for (const entry of Object.values(server.headers || {})) {
		const resolved = resolveMcpValue(entry);
		if (resolved?.value) values.push(resolved.value.replace(/^Bearer\s+/i, ''));
	}
	return values.filter(Boolean);
}

function redactDiagnostic(value, server) {
	let text = String(value || '').slice(-2000);
	for (const secret of configuredValues(server)) {
		if (secret.length > 2) text = text.split(secret).join('[redacted]');
	}
	return text;
}

function initialAuthStatus(server = {}) {
	return configuredValues(server).length > 0 ? 'configured' : 'anonymous';
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
		this.status.set(server.id, {
			...(await this.getServerStatus(server.id)),
			server,
			status: 'starting',
			error: null,
			lastError: '',
			diagnostic: '',
			auth: { status: initialAuthStatus(server) },
		});
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
				tools, toolDefinitions: adaptMcpTools({ server, tools }), error: null, lastError: '',
				diagnostic: redactDiagnostic(client.diagnostic, server),
				auth: { status: initialAuthStatus(server) },
			};
			this.status.set(server.id, nextStatus);
			return nextStatus;
		} catch (err) {
			const error = classifyMcpError(err);
			this.status.set(server.id, {
				...(await this.getServerStatus(server.id)), server, status: 'error',
				error,
				lastError: error.message,
				diagnostic: redactDiagnostic(client?.diagnostic, server),
				auth: { status: error.code === 'authentication_failed' ? 'invalid' : initialAuthStatus(server) },
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
			diagnostic: '',
			error: null,
			auth: { status: server ? initialAuthStatus(server) : 'unknown' },
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
			const current = await this.getServerStatus(parsed.serverId);
			this.status.set(parsed.serverId, { ...current, auth: { status: 'verified' } });
			return output;
		} catch (err) {
			this.runtimeLog.record({ serverId: parsed.serverId, toolName: parsed.toolName, argumentKeys: Object.keys(input || {}), error: String(err.message || err), durationMs: Date.now() - startedAt });
			const current = await this.getServerStatus(parsed.serverId);
			const error = classifyMcpError(err);
			this.status.set(parsed.serverId, {
				...current,
				status: 'error',
				error,
				lastError: error.message,
				auth: { status: error.code === 'authentication_failed' ? 'invalid' : current.auth?.status || 'unknown' },
			});
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
		const next = { ...previous, status: 'stopped', connectedAt: null, error: null, lastError: '', diagnostic: '' };
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
