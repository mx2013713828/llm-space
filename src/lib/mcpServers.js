import { apiFetch } from './apiClient.js';

export async function fetchMcpPresets() {
	const res = await apiFetch('/api/mcp/presets');
	if (!res.ok) throw new Error(`Failed to load MCP presets (${res.status})`);
	return res.json();
}

export async function fetchMcpServers() {
	const res = await apiFetch('/api/mcp/servers');
	if (!res.ok) throw new Error(`Failed to load MCP servers (${res.status})`);
	return res.json();
}

export async function saveMcpServer(server) {
	const res = await apiFetch('/api/mcp/servers', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(server),
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || `Failed to save MCP server (${res.status})`);
	return data;
}

export async function deleteMcpServer(serverId) {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}`, { method: 'DELETE' });
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || `Failed to delete MCP server (${res.status})`);
	return data;
}

export async function connectMcpServer(serverId) {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/connect`, { method: 'POST' });
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || `Failed to connect MCP server (${res.status})`);
	return data;
}

export async function testMcpTool(serverId, toolName, args = {}) {
	const res = await apiFetch(`/api/mcp/servers/${encodeURIComponent(serverId)}/test-tool`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ toolName, arguments: args }),
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || `Failed to test MCP tool (${res.status})`);
	return data;
}

export async function fetchHarnessMcpMount(harnessId) {
	if (!harnessId) return { mount: { enabled: false, mountedServers: [], toolAllowlist: {} }, toolDefinitions: [] };
	const res = await apiFetch(`/api/harnesses/${encodeURIComponent(harnessId)}/mcp`);
	if (!res.ok) throw new Error(`Failed to load harness MCP mount (${res.status})`);
	return res.json();
}

export async function saveHarnessMcpMount(harnessId, mount) {
	const res = await apiFetch(`/api/harnesses/${encodeURIComponent(harnessId)}/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(mount),
	});
	const data = await res.json();
	if (!res.ok) throw new Error(data.error || `Failed to save harness MCP mount (${res.status})`);
	return data;
}
