import path from 'path';
import { promises as fs } from 'fs';

import { normalizeMcpName } from './mcpNames.js';

const DEFAULT_ROOT_DIR = process.cwd();
const APPROVAL_MODES = new Set(['auto_readonly', 'ask_all', 'auto_all']);

function assertHarnessId(harnessId) {
	const id = String(harnessId || '').trim();
	if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
		throw new Error('Invalid harness ID format');
	}
	return id;
}

function getMountPath(rootDir, harnessId) {
	return path.join(rootDir, '.mcp', 'mounts', `${assertHarnessId(harnessId)}.json`);
}

export function normalizeMcpMount(mount = {}) {
	const mountedServers = Array.isArray(mount.mountedServers)
		? mount.mountedServers.map(normalizeMcpName).filter(Boolean)
		: [];
	const toolAllowlist = {};
	if (mount.toolAllowlist && typeof mount.toolAllowlist === 'object' && !Array.isArray(mount.toolAllowlist)) {
		for (const [serverId, tools] of Object.entries(mount.toolAllowlist)) {
			toolAllowlist[normalizeMcpName(serverId)] = Array.isArray(tools) ? tools.map(String) : [];
		}
	}
	const serverApprovalModes = {};
	if (mount.serverApprovalModes && typeof mount.serverApprovalModes === 'object' && !Array.isArray(mount.serverApprovalModes)) {
		for (const [serverId, mode] of Object.entries(mount.serverApprovalModes)) {
			const normalizedServerId = normalizeMcpName(serverId);
			if (normalizedServerId && APPROVAL_MODES.has(mode)) {
				serverApprovalModes[normalizedServerId] = mode;
			}
		}
	}
	const toolApprovalModes = {};
	if (mount.toolApprovalModes && typeof mount.toolApprovalModes === 'object' && !Array.isArray(mount.toolApprovalModes)) {
		for (const [serverId, tools] of Object.entries(mount.toolApprovalModes)) {
			const normalizedServerId = normalizeMcpName(serverId);
			if (!normalizedServerId || !tools || typeof tools !== 'object' || Array.isArray(tools)) continue;
			const normalizedTools = {};
			for (const [toolName, mode] of Object.entries(tools)) {
				if (String(toolName).trim() && APPROVAL_MODES.has(mode)) {
					normalizedTools[String(toolName).trim()] = mode;
				}
			}
			if (Object.keys(normalizedTools).length > 0) {
				toolApprovalModes[normalizedServerId] = normalizedTools;
			}
		}
	}
	return {
		enabled: mount.enabled === true,
		mountedServers,
		toolAllowlist,
		approvalMode: APPROVAL_MODES.has(mount.approvalMode)
			? mount.approvalMode
			: 'auto_readonly',
		serverApprovalModes,
		toolApprovalModes,
	};
}

export async function loadMcpMount({ harnessId, rootDir = DEFAULT_ROOT_DIR, fsImpl = fs } = {}) {
	try {
		const content = await fsImpl.readFile(getMountPath(rootDir, harnessId), 'utf-8');
		return normalizeMcpMount(JSON.parse(content));
	} catch (err) {
		if (err?.code === 'ENOENT') return normalizeMcpMount();
		throw err;
	}
}

export async function saveMcpMount({ harnessId, mount, rootDir = DEFAULT_ROOT_DIR, fsImpl = fs } = {}) {
	const normalized = normalizeMcpMount(mount);
	const filePath = getMountPath(rootDir, harnessId);
	await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
	await fsImpl.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
	return normalized;
}
