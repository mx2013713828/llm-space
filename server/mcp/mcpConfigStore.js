import path from 'path';
import { promises as fs } from 'fs';

import { normalizeMcpName } from './mcpNames.js';

const DEFAULT_ROOT_DIR = process.cwd();
const MCP_CONFIG_PATH = path.join('.mcp', 'servers.json');

const CONTEXT7_PRESET = {
	id: 'context7',
	name: 'Context7',
	description: 'Developer documentation MCP server powered by Context7.',
	transport: 'stdio',
	command: 'npx',
	args: ['-y', '@upstash/context7-mcp'],
	cwd: '.',
	env: {},
	enabled: true,
};

function getConfigPath(rootDir = DEFAULT_ROOT_DIR) {
	return path.join(rootDir, MCP_CONFIG_PATH);
}

function normalizeTransport(value) {
	const normalized = String(value || 'stdio').trim().toLowerCase().replace(/-/g, '_');
	if (normalized === 'http' || normalized === 'streamable_http') return 'streamable_http';
	return 'stdio';
}

export function normalizeMcpServerConfig(server = {}) {
	const name = String(server.name || server.id || 'MCP Server').trim();
	const id = normalizeMcpName(server.id || name);
	const transport = normalizeTransport(server.transport);
	const normalized = {
		id,
		name,
		description: String(server.description || '').trim(),
		transport,
		enabled: server.enabled !== false,
		env: server.env && typeof server.env === 'object' && !Array.isArray(server.env) ? { ...server.env } : {},
		auth: server.auth && typeof server.auth === 'object' && !Array.isArray(server.auth) ? { ...server.auth } : { type: 'none' },
		toolAllowlist: Array.isArray(server.toolAllowlist) ? [...server.toolAllowlist] : [],
		lastTools: Array.isArray(server.lastTools) ? [...server.lastTools] : [],
	};

	if (transport === 'streamable_http') {
		normalized.url = String(server.url || '').trim();
		normalized.headers = server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers)
			? { ...server.headers }
			: {};
	} else {
		normalized.command = String(server.command || '').trim();
		normalized.args = Array.isArray(server.args) ? server.args.map(String) : [];
		normalized.cwd = String(server.cwd || '.').trim() || '.';
	}

	return normalized;
}

export function getMcpPresets() {
	return [{ ...CONTEXT7_PRESET, args: [...CONTEXT7_PRESET.args], env: { ...CONTEXT7_PRESET.env } }];
}

export async function listMcpServers({ rootDir = DEFAULT_ROOT_DIR, fsImpl = fs } = {}) {
	try {
		const content = await fsImpl.readFile(getConfigPath(rootDir), 'utf-8');
		const parsed = JSON.parse(content);
		return (Array.isArray(parsed.servers) ? parsed.servers : []).map(normalizeMcpServerConfig);
	} catch (err) {
		if (err?.code === 'ENOENT') return [];
		throw err;
	}
}

export async function saveMcpServers({ servers = [], rootDir = DEFAULT_ROOT_DIR, fsImpl = fs } = {}) {
	const normalized = (Array.isArray(servers) ? servers : []).map(normalizeMcpServerConfig);
	const configPath = getConfigPath(rootDir);
	await fsImpl.mkdir(path.dirname(configPath), { recursive: true });
	await fsImpl.writeFile(configPath, JSON.stringify({ servers: normalized }, null, 2), 'utf-8');
	return normalized;
}

export async function upsertMcpServer({ server, rootDir = DEFAULT_ROOT_DIR, fsImpl = fs } = {}) {
	const nextServer = normalizeMcpServerConfig(server);
	const servers = await listMcpServers({ rootDir, fsImpl });
	const index = servers.findIndex(item => item.id === nextServer.id);
	const nextServers = [...servers];
	if (index >= 0) {
		nextServers[index] = { ...servers[index], ...nextServer };
	} else {
		nextServers.push(nextServer);
	}
	await saveMcpServers({ servers: nextServers, rootDir, fsImpl });
	return nextServer;
}

export async function deleteMcpServer({ serverId, rootDir = DEFAULT_ROOT_DIR, fsImpl = fs } = {}) {
	const id = normalizeMcpName(serverId);
	const servers = await listMcpServers({ rootDir, fsImpl });
	await saveMcpServers({
		servers: servers.filter(server => server.id !== id),
		rootDir,
		fsImpl,
	});
}
