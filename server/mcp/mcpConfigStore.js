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

function normalizeLegacyAuth(auth) {
	if (auth?.type !== 'bearer') return null;
	const env = String(auth.env || '').trim();
	return env ? { type: 'bearer', env } : null;
}

export function normalizeMcpStringMap(value = {}) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
	return Object.fromEntries(
		Object.entries(value)
			.map(([key, entry]) => [String(key || '').trim(), String(entry || '').trim()])
			.filter(([key, entry]) => key && entry),
	);
}

export function normalizeMcpServerConfig(server = {}, { preserveLegacyAuth = true } = {}) {
	const name = String(server.name || server.id || 'MCP Server').trim();
	const id = normalizeMcpName(server.id || name);
	const transport = normalizeTransport(server.transport);
	const normalized = {
		id,
		name,
		description: String(server.description || '').trim(),
		transport,
		enabled: server.enabled !== false,
		env: normalizeMcpStringMap(server.env),
		toolAllowlist: Array.isArray(server.toolAllowlist) ? [...server.toolAllowlist] : [],
		lastTools: Array.isArray(server.lastTools) ? [...server.lastTools] : [],
	};

	if (transport === 'streamable_http') {
		normalized.url = String(server.url || '').trim();
		normalized.headers = normalizeMcpStringMap(server.headers);
	} else {
		normalized.command = String(server.command || '').trim();
		normalized.args = Array.isArray(server.args) ? server.args.map(String) : [];
		normalized.cwd = String(server.cwd || '.').trim() || '.';
	}

	const legacyAuth = preserveLegacyAuth ? normalizeLegacyAuth(server.auth) : null;
	if (legacyAuth) normalized.auth = legacyAuth;

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
	const nextServer = normalizeMcpServerConfig(server, { preserveLegacyAuth: false });
	const servers = await listMcpServers({ rootDir, fsImpl });
	const index = servers.findIndex(item => item.id === nextServer.id);
	const nextServers = [...servers];
	if (index >= 0) {
		const existingWithoutLegacyAuth = { ...servers[index] };
		delete existingWithoutLegacyAuth.auth;
		nextServers[index] = { ...existingWithoutLegacyAuth, ...nextServer };
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
