import { normalizeMcpName } from './mcpNames.js';

const APPROVAL_MODES = new Set(['auto_readonly', 'ask_all', 'auto_all']);

function validMode(value) {
	return APPROVAL_MODES.has(value) ? value : null;
}

export function resolveMcpApprovalPolicy({ mount = {}, toolDefinition = {} } = {}) {
	const serverId = normalizeMcpName(toolDefinition?.mcp?.serverId);
	const toolName = String(toolDefinition?.mcp?.toolName || '').trim();
	const toolMode = validMode(mount?.toolApprovalModes?.[serverId]?.[toolName]);
	const serverMode = validMode(mount?.serverApprovalModes?.[serverId]);
	const harnessMode = validMode(mount?.approvalMode) || 'auto_readonly';

	const mode = toolMode || serverMode || harnessMode;
	const source = toolMode ? 'tool' : serverMode ? 'server' : 'harness';
	const requiresApproval = mode === 'ask_all'
		|| (mode === 'auto_readonly' && toolDefinition?.annotations?.readOnlyHint !== true);

	return { mode, source, requiresApproval };
}
