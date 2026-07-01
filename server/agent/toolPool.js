import { parseFeatures } from './FeatureParser.js';

export const TASK_SYSTEM_PLANNING_TOOLS = [
	'create_task',
	'list_tasks',
	'get_task',
	'claim_task',
	'complete_task',
];

export const TODO_PLANNING_TOOLS = ['write_todos'];
export const DELEGATION_TOOLS = ['sub_agent'];
export const BACKGROUND_TASK_TOOLS = ['query_background_tasks'];
export const CRON_TOOLS = ['schedule_cron', 'list_crons', 'cancel_cron'];
export const TEAM_LEAD_TOOLS = ['spawn_teammate', 'wait_for_teammates', 'check_team_inbox'];
export const TEAM_COMMUNICATION_TOOLS = ['send_team_message'];
export const TEAM_TOOLS = [...TEAM_LEAD_TOOLS, ...TEAM_COMMUNICATION_TOOLS];

export const ORCHESTRATION_MANAGED_TOOL_NAMES = [
	...TODO_PLANNING_TOOLS,
	...TASK_SYSTEM_PLANNING_TOOLS,
	...DELEGATION_TOOLS,
	...BACKGROUND_TASK_TOOLS,
	...CRON_TOOLS,
];

export const TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES = [
	...ORCHESTRATION_MANAGED_TOOL_NAMES,
	...TEAM_TOOLS,
];

const REVIEWER_BLOCKED_TOOL_NAMES = [
	'write_file',
	'replace_file_content',
	'multi_replace_file_content',
	'run_command',
];

const VERIFIER_BLOCKED_TOOL_NAMES = [
	'replace_file_content',
	'multi_replace_file_content',
	'run_command',
];

export function getToolName(tool) {
	if (typeof tool === 'string') return tool;
	return tool?.name ?? '';
}

export function isOrchestrationEnabled(orchestration, capability) {
	if (orchestration?.enabled === false) return false;
	if (!capability) return orchestration?.enabled !== false;
	return orchestration?.[capability] === true;
}

function dedupeToolsByName(tools = []) {
	const seen = new Set();
	const result = [];

	for (const tool of tools) {
		const name = getToolName(tool);
		if (!name || seen.has(name)) continue;
		seen.add(name);
		result.push(tool);
	}

	return result;
}

function removeTools(tools, namesToRemove) {
	const removeSet = new Set(namesToRemove);
	return tools.filter(tool => !removeSet.has(getToolName(tool)));
}

function appendTools(tools, nextTools) {
	return dedupeToolsByName([...tools, ...(nextTools ?? [])]);
}

function getMountedTools(mountedResources) {
	if (Array.isArray(mountedResources)) return mountedResources;
	if (Array.isArray(mountedResources?.tools)) return mountedResources.tools;
	return [];
}

function getRemovedToolNames(originalTools, nextTools) {
	const nextNames = new Set(nextTools.map(getToolName));
	const removed = [];
	for (const tool of originalTools) {
		const name = getToolName(tool);
		if (name && !nextNames.has(name) && !removed.includes(name)) {
			removed.push(name);
		}
	}
	return removed;
}

function getAddedToolNames(originalTools, nextTools) {
	const originalNames = new Set(originalTools.map(getToolName));
	const added = [];
	for (const tool of nextTools) {
		const name = getToolName(tool);
		if (name && !originalNames.has(name) && !added.includes(name)) {
			added.push(name);
		}
	}
	return added;
}

function applyLeadOrchestrationTools(tools, orchestration) {
	if (!isOrchestrationEnabled(orchestration)) {
		return tools;
	}

	let resolved = [...tools];
	if (orchestration?.mode === 'task_system') {
		resolved = appendTools(resolved, TASK_SYSTEM_PLANNING_TOOLS);
	} else {
		resolved = appendTools(resolved, TODO_PLANNING_TOOLS);
	}

	if (isOrchestrationEnabled(orchestration, 'enable_sub_agents')) {
		resolved = appendTools(resolved, DELEGATION_TOOLS);
	}

	if (isOrchestrationEnabled(orchestration, 'enable_background_tasks')) {
		resolved = appendTools(resolved, BACKGROUND_TASK_TOOLS);
	}

	if (isOrchestrationEnabled(orchestration, 'enable_cron_scheduler')) {
		resolved = appendTools(resolved, CRON_TOOLS);
	}

	if (isOrchestrationEnabled(orchestration, 'enable_agent_teams')) {
		resolved = appendTools(resolved, [TEAM_LEAD_TOOLS[0]]);
		resolved = appendTools(resolved, TEAM_COMMUNICATION_TOOLS);
		resolved = appendTools(resolved, TEAM_LEAD_TOOLS.slice(1));
	}

	return resolved;
}

function filterBaseToolsForRuntimeRole(tools, runtimeRole) {
	if (runtimeRole === 'teammate') {
		return removeTools(tools, TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES);
	}

	if (runtimeRole === 'sub_agent') {
		return removeTools(tools, TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES);
	}

	if (runtimeRole === 'reviewer') {
		return removeTools(
			removeTools(tools, TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES),
			REVIEWER_BLOCKED_TOOL_NAMES,
		);
	}

	if (runtimeRole === 'verifier') {
		return removeTools(
			removeTools(tools, TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES),
			VERIFIER_BLOCKED_TOOL_NAMES,
		);
	}

	return removeTools(tools, TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES);
}

function applyRuntimeRoleTools(tools, runtimeRole, orchestration) {
	if (runtimeRole === 'teammate') {
		return appendTools(tools, TEAM_COMMUNICATION_TOOLS);
	}

	if (runtimeRole === 'sub_agent' || runtimeRole === 'reviewer' || runtimeRole === 'verifier') {
		return tools;
	}

	return applyLeadOrchestrationTools(tools, orchestration);
}

export function assembleToolPool({
	baseTools = [],
	features = {},
	runtimeRole = 'lead',
	strategyId = '',
	mountedResources = null,
} = {}) {
	const normalizedFeatures = parseFeatures(features);
	const orchestration = normalizedFeatures.task_orchestration;
	const originalTools = dedupeToolsByName([...baseTools, ...getMountedTools(mountedResources)]);
	const filteredBaseTools = filterBaseToolsForRuntimeRole(originalTools, runtimeRole);
	let tools = applyRuntimeRoleTools(filteredBaseTools, runtimeRole, orchestration);
	tools = removeTools(tools, ['get_current_time']);
	tools = appendTools(tools, ['get_current_time']);

	return {
		tools,
		toolNames: tools.map(getToolName),
		features: normalizedFeatures,
		runtimeRole,
		strategyId: String(strategyId || '').trim(),
		addedToolNames: getAddedToolNames(originalTools, tools),
		removedToolNames: getRemovedToolNames(originalTools, filteredBaseTools),
	};
}

export function filterToolsForRuntimeRole(toolPool, runtimeRole) {
	const pool = Array.isArray(toolPool)
		? { tools: toolPool, features: {}, strategyId: '' }
		: (toolPool ?? {});

	return assembleToolPool({
		baseTools: pool.tools ?? [],
		features: pool.features ?? {},
		runtimeRole,
		strategyId: pool.strategyId ?? '',
	});
}

export function describeToolPool(toolPool) {
	const pool = toolPool ?? assembleToolPool();
	const orchestration = pool.features?.task_orchestration ?? {};
	return {
		runtimeRole: pool.runtimeRole || 'lead',
		strategyId: pool.strategyId || '',
		count: Array.isArray(pool.tools) ? pool.tools.length : 0,
		names: (pool.tools ?? []).map(getToolName).filter(Boolean),
		added: pool.addedToolNames ?? [],
		removed: pool.removedToolNames ?? [],
		orchestration: {
			enabled: isOrchestrationEnabled(orchestration),
			mode: orchestration?.mode || 'todo',
			subAgents: isOrchestrationEnabled(orchestration, 'enable_sub_agents'),
			backgroundTasks: isOrchestrationEnabled(orchestration, 'enable_background_tasks'),
			agentTeams: isOrchestrationEnabled(orchestration, 'enable_agent_teams'),
			cronScheduler: isOrchestrationEnabled(orchestration, 'enable_cron_scheduler'),
		},
	};
}
