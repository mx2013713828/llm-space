const DEFAULT_LIMIT_PER_SERVER = 50;
const DEFAULT_PREVIEW_LIMIT = 2000;

function clip(value, limit) {
	const text = String(value || '');
	return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

export class McpRuntimeLog {
	constructor({ limitPerServer = DEFAULT_LIMIT_PER_SERVER, previewLimit = DEFAULT_PREVIEW_LIMIT } = {}) {
		this.limitPerServer = limitPerServer;
		this.previewLimit = previewLimit;
		this.records = new Map();
	}

	record({ serverId, toolName, argumentKeys = [], output = '', error = '', durationMs = 0, status = '' } = {}) {
		const record = {
			id: `mcp_call_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
			serverId: String(serverId || ''),
			toolName: String(toolName || ''),
			startedAt: new Date().toISOString(),
			durationMs: Math.max(0, Number(durationMs) || 0),
			status: status || (error ? 'error' : 'success'),
			argumentKeys: Array.isArray(argumentKeys) ? argumentKeys.map(String) : [],
			outputPreview: clip(error || output, this.previewLimit),
			error: clip(error, this.previewLimit),
		};
		const next = [record, ...(this.records.get(record.serverId) || [])].slice(0, this.limitPerServer);
		this.records.set(record.serverId, next);
		return record;
	}

	list(serverId, { limit = this.limitPerServer } = {}) {
		return (this.records.get(String(serverId || '')) || []).slice(0, Math.max(0, Number(limit) || 0));
	}

	get(serverId, callId) {
		return this.list(serverId).find(record => record.id === callId) || null;
	}
}
