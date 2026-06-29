import {
	ORCHESTRATION_MANAGED_TOOL_NAMES,
	TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES,
	getToolName,
} from '../../../src/lib/taskOrchestration.js';

function cloneFeatures(parentFeatures) {
	return structuredClone(parentFeatures ?? {});
}

function dedupeToolsByName(tools) {
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

function getFilteredToolNames(toolFilter) {
	if (toolFilter === 'hidden_orchestration') {
		return TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES;
	}
	if (toolFilter === 'managed_orchestration') {
		return ORCHESTRATION_MANAGED_TOOL_NAMES;
	}
	return [];
}

export function createChildFeatures(parentFeatures, policy = {}) {
	const childFeatures = cloneFeatures(parentFeatures);

	if (policy.taskOrchestration) {
		childFeatures.task_orchestration = {
			...(childFeatures.task_orchestration ?? {}),
			...policy.taskOrchestration,
		};
	}

	if (policy.memoryEnabled !== undefined) {
		childFeatures.enable_memory = {
			...(childFeatures.enable_memory ?? {}),
			enabled: policy.memoryEnabled,
		};
	}

	return childFeatures;
}

export function selectChildTools(parentTools, policy = {}) {
	const tools = Array.isArray(parentTools) ? parentTools : [];
	const filteredToolNames = getFilteredToolNames(policy.toolFilter);
	const filtered = tools.filter(tool => !filteredToolNames.includes(getToolName(tool)));
	const appended = [...filtered, ...(policy.appendTools ?? [])];

	return dedupeToolsByName(appended);
}

export function createChildAgentProfile({
	childType,
	childId,
	name = null,
	role = null,
	parentHarnessId = 'default',
	prompt,
	systemPrompt,
	parentTools,
	parentFeatures,
	featurePolicy = {},
	toolPolicy = {},
	messages = null,
	extra = {},
}) {
	return {
		identity: {
			childType,
			childId,
			name,
			role,
			parentHarnessId,
		},
		messages: messages ?? [{ role: 'user', content: prompt }],
		systemPrompt,
		tools: selectChildTools(parentTools, toolPolicy),
		features: createChildFeatures(parentFeatures, featurePolicy),
		...extra,
	};
}
