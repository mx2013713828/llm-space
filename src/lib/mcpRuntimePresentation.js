export function formatMcpStatus(status = {}) {
	const value = status?.status || 'stopped';
	const labels = {
		starting: 'Starting',
		connected: 'Connected',
		error: 'Error',
		stopped: 'Stopped',
	};
	return { value, label: labels[value] || 'Unknown', tone: value };
}

export function formatMcpAuthStatus(auth = {}) {
	const value = auth?.status || 'unknown';
	const labels = {
		anonymous: 'Anonymous',
		configured: 'Credential configured',
		verified: 'Verified',
		invalid: 'Invalid credential',
		unknown: 'Unknown',
	};
	return { value, label: labels[value] || 'Unknown', tone: value };
}

export function formatMcpCallSummary(call = {}) {
	return {
		id: String(call.id || ''),
		label: call.toolName || 'MCP tool',
		meta: `${call.status || 'unknown'} · ${Number(call.durationMs) || 0}ms · ${(call.argumentKeys || []).length} argument key(s)`,
		error: call.status === 'error' ? (call.error || call.outputPreview || 'Call failed') : '',
	};
}
