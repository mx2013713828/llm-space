export function normalizeMcpName(value) {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_{2,}/g, '_');
	return normalized || 'mcp';
}

export function buildMcpToolName(serverId, toolName) {
	return `mcp__${normalizeMcpName(serverId)}__${normalizeMcpName(toolName)}`;
}

export function parseMcpToolName(name) {
	const match = /^mcp__([^_][a-z0-9_-]*)__([^_].+)$/.exec(String(name || ''));
	if (!match) return null;
	return {
		serverId: match[1],
		toolName: match[2],
	};
}
