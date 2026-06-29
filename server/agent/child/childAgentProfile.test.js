import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createChildAgentProfile,
	createChildFeatures,
	createReviewerProfile,
	createVerifierProfile,
	selectChildTools,
} from './childAgentProfile.js';

test('createChildFeatures deep-clones parent features and applies child policy', () => {
	const parentFeatures = {
		task_orchestration: {
			enabled: true,
			mode: 'task_system',
			enable_sub_agents: true,
			enable_background_tasks: true,
		},
		enable_memory: {
			enabled: true,
			provider: 'local',
		},
		security_mode: 'strict',
		context_compaction: {
			enabled: true,
		},
	};

	const features = createChildFeatures(parentFeatures, {
		taskOrchestration: {
			enabled: false,
			enable_sub_agents: false,
		},
		memoryEnabled: false,
	});

	assert.notEqual(features, parentFeatures);
	assert.notEqual(features.task_orchestration, parentFeatures.task_orchestration);
	assert.notEqual(features.enable_memory, parentFeatures.enable_memory);
	assert.equal(features.task_orchestration.enabled, false);
	assert.equal(features.task_orchestration.mode, 'task_system');
	assert.equal(features.task_orchestration.enable_sub_agents, false);
	assert.equal(features.enable_memory.enabled, false);
	assert.equal(features.enable_memory.provider, 'local');
	assert.equal(features.security_mode, 'strict');
	assert.deepEqual(features.context_compaction, { enabled: true });
	assert.equal(parentFeatures.task_orchestration.enabled, true);
	assert.equal(parentFeatures.enable_memory.enabled, true);
});

test('selectChildTools removes hidden orchestration tools and appends communication tools once', () => {
	const tools = selectChildTools(
		[
			'bash',
			'sub_agent',
			'write_todos',
			'send_team_message',
			'spawn_teammate',
			{ name: 'custom_tool' },
		],
		{
			toolFilter: 'hidden_orchestration',
			appendTools: ['send_team_message'],
		},
	);

	assert.deepEqual(tools, ['bash', { name: 'custom_tool' }, 'send_team_message']);
});

test('selectChildTools removes managed orchestration tools but preserves team communication tools', () => {
	const tools = selectChildTools(
		['bash', 'sub_agent', 'write_todos', 'send_team_message', { name: 'custom_tool' }],
		{ toolFilter: 'managed_orchestration' },
	);

	assert.deepEqual(tools, ['bash', 'send_team_message', { name: 'custom_tool' }]);
});

test('createChildAgentProfile composes identity, prompt, tools, features, and messages', () => {
	const profile = createChildAgentProfile({
		childType: 'sub_agent',
		childId: 'tool_123',
		name: 'worker',
		role: 'Investigator',
		parentHarnessId: 'h1',
		prompt: 'Inspect the code.',
		systemPrompt: 'You are a child agent.',
		parentTools: ['bash', 'sub_agent', { name: 'custom_tool' }],
		parentFeatures: {
			task_orchestration: { enabled: true, enable_sub_agents: true },
			enable_memory: { enabled: true },
		},
		featurePolicy: {
			taskOrchestration: { enabled: false, enable_sub_agents: false },
			memoryEnabled: false,
		},
		toolPolicy: {
			toolFilter: 'managed_orchestration',
		},
	});

	assert.deepEqual(profile.identity, {
		childType: 'sub_agent',
		childId: 'tool_123',
		name: 'worker',
		role: 'Investigator',
		parentHarnessId: 'h1',
	});
	assert.deepEqual(profile.messages, [{ role: 'user', content: 'Inspect the code.' }]);
	assert.equal(profile.systemPrompt, 'You are a child agent.');
	assert.deepEqual(profile.tools, ['bash', { name: 'custom_tool' }]);
	assert.equal(profile.features.task_orchestration.enabled, false);
	assert.equal(profile.features.enable_memory.enabled, false);
});

test('createReviewerProfile is read-only by default and strips orchestration plus write tools', () => {
	const profile = createReviewerProfile({
		parentExecutor: {
			harnessId: 'h1',
			tools: ['bash', 'read_file', 'write_file', 'run_command', 'spawn_teammate', { name: 'custom_tool' }],
			features: {
				task_orchestration: { enabled: true, enable_agent_teams: true },
				enable_memory: { enabled: true },
			},
		},
		prompt: 'Review the code.',
		childId: 'reviewer_1',
		role: 'Code reviewer',
	});

	assert.equal(profile.identity.childType, 'reviewer');
	assert.equal(profile.identity.role, 'Code reviewer');
	assert.deepEqual(profile.tools, ['bash', 'read_file', { name: 'custom_tool' }]);
	assert.equal(profile.features.enable_memory.enabled, false);
	assert.match(profile.systemPrompt, /read-only by default/i);
	assert.match(profile.systemPrompt, /structured findings/i);
});

test('createVerifierProfile keeps atomic verification tools and prepares verifier prompt', () => {
	const profile = createVerifierProfile({
		parentExecutor: {
			harnessId: 'h1',
			tools: ['bash', 'read_file', 'write_file', 'sub_agent', 'check_team_inbox', { name: 'custom_tool' }],
			features: {
				task_orchestration: { enabled: true, enable_sub_agents: true, enable_agent_teams: true },
				enable_memory: { enabled: true },
			},
		},
		prompt: 'Verify the fix.',
		childId: 'verifier_1',
		role: 'Test verifier',
	});

	assert.equal(profile.identity.childType, 'verifier');
	assert.deepEqual(profile.tools, ['bash', 'read_file', 'write_file', { name: 'custom_tool' }]);
	assert.equal(profile.features.enable_memory.enabled, false);
	assert.match(profile.systemPrompt, /verification evidence/i);
	assert.match(profile.systemPrompt, /scratch workspace/i);
});
