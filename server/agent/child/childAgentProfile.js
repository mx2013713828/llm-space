import {
	ORCHESTRATION_MANAGED_TOOL_NAMES,
	TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES,
	getToolName,
} from '../../../src/lib/taskOrchestration.js';
import { createScratchWorkspacePolicy } from './scratchWorkspacePolicy.js';

const WRITE_ORIENTED_TOOL_NAMES = new Set([
	'write_file',
	'replace_file_content',
	'multi_replace_file_content',
	'run_command',
]);

const REVIEWER_SYSTEM_PROMPT = [
	'You are a focused reviewer child agent.',
	'You are read-only by default: inspect code and report findings without modifying files.',
	'Return structured findings with severity, file references, and a concise recommendation.',
	'If no blocking issues are found, say so clearly.',
].join('\n');

const VERIFIER_SYSTEM_PROMPT = [
	'You are a verifier child agent.',
	'Use available tools to gather verification evidence for the assigned claim or change.',
	'Prefer a scratch workspace for temporary files when you need to create fixtures or scripts.',
	'Return the commands, results, and conclusion as concise verification evidence.',
].join('\n');

function appendScratchInstruction(systemPrompt, scratchWorkspace) {
	if (!scratchWorkspace?.enabled || !scratchWorkspace.instruction) {
		return systemPrompt;
	}

	return `${systemPrompt}\n\nScratch workspace:\n${scratchWorkspace.instruction}`;
}

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
	scratchWorkspace = null,
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
		systemPrompt: appendScratchInstruction(systemPrompt, scratchWorkspace),
		tools: selectChildTools(parentTools, toolPolicy),
		features: createChildFeatures(parentFeatures, featurePolicy),
		...(scratchWorkspace ? { scratchWorkspace } : {}),
		...extra,
	};
}

export function createReviewerProfile({
	parentExecutor,
	prompt,
	childId,
	role = 'Reviewer',
	name = 'reviewer',
}) {
	const baseProfile = createChildAgentProfile({
		childType: 'reviewer',
		childId,
		name,
		role,
		parentHarnessId: parentExecutor.harnessId || 'default',
		prompt,
		systemPrompt: REVIEWER_SYSTEM_PROMPT,
		parentTools: parentExecutor.tools,
		parentFeatures: parentExecutor.features,
		featurePolicy: {
			taskOrchestration: {
				enabled: false,
			},
			memoryEnabled: false,
		},
		toolPolicy: {
			toolFilter: 'hidden_orchestration',
		},
	});

	return {
		...baseProfile,
		tools: baseProfile.tools.filter(tool => !WRITE_ORIENTED_TOOL_NAMES.has(getToolName(tool))),
	};
}

export function createVerifierProfile({
	parentExecutor,
	prompt,
	childId,
	role = 'Verifier',
	name = 'verifier',
}) {
	return createChildAgentProfile({
		childType: 'verifier',
		childId,
		name,
		role,
		parentHarnessId: parentExecutor.harnessId || 'default',
		prompt,
		systemPrompt: VERIFIER_SYSTEM_PROMPT,
		parentTools: parentExecutor.tools,
		parentFeatures: parentExecutor.features,
		featurePolicy: {
			taskOrchestration: {
				enabled: false,
			},
			memoryEnabled: false,
		},
		toolPolicy: {
			toolFilter: 'hidden_orchestration',
		},
		scratchWorkspace: createScratchWorkspacePolicy({
			runId: parentExecutor.harnessId || 'default',
			childId,
		}),
	});
}
