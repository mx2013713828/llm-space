import test from 'node:test';
import assert from 'node:assert/strict';

import {
	assembleToolPool,
	describeToolPool,
	filterToolsForRuntimeRole,
	getToolName,
} from './toolPool.js';

test('lead task-system mode assembles planning, delegation, background, cron, team, and time tools', () => {
	const pool = assembleToolPool({
		baseTools: ['bash', 'sub_agent', 'bash', { name: 'custom_tool' }],
		features: {
			task_orchestration: {
				enabled: true,
				mode: 'task_system',
				enable_sub_agents: true,
				enable_background_tasks: true,
				enable_agent_teams: true,
				enable_cron_scheduler: true,
			},
		},
		runtimeRole: 'lead',
		strategyId: 'async_teams',
	});

	assert.deepEqual(pool.tools, [
		'bash',
		{ name: 'custom_tool' },
		'create_task',
		'list_tasks',
		'get_task',
		'claim_task',
		'complete_task',
		'sub_agent',
		'query_background_tasks',
		'schedule_cron',
		'list_crons',
		'cancel_cron',
		'spawn_teammate',
		'send_team_message',
		'wait_for_teammates',
		'check_team_inbox',
		'get_current_time',
	]);
	assert.equal(pool.runtimeRole, 'lead');
	assert.equal(pool.strategyId, 'async_teams');
	assert.deepEqual(pool.addedToolNames, [
		'create_task',
		'list_tasks',
		'get_task',
		'claim_task',
		'complete_task',
		'query_background_tasks',
		'schedule_cron',
		'list_crons',
		'cancel_cron',
		'spawn_teammate',
		'send_team_message',
		'wait_for_teammates',
		'check_team_inbox',
		'get_current_time',
	]);
	assert.deepEqual(pool.removedToolNames, ['sub_agent']);
});

test('lead todo mode mounts only write_todos plus time when optional primitives are disabled', () => {
	const pool = assembleToolPool({
		baseTools: ['bash', 'write_todos', 'sub_agent', 'schedule_cron'],
		features: {
			task_orchestration: {
				enabled: true,
				mode: 'todo',
				enable_sub_agents: false,
				enable_background_tasks: false,
				enable_agent_teams: false,
				enable_cron_scheduler: false,
			},
		},
	});

	assert.deepEqual(pool.tools, ['bash', 'write_todos', 'get_current_time']);
});

test('orchestration-disabled lead strips all orchestration-managed tools but preserves mounted resources', () => {
	const pool = assembleToolPool({
		baseTools: ['bash', 'sub_agent', 'spawn_teammate', 'send_team_message', 'write_todos'],
		features: {
			task_orchestration: {
				enabled: false,
				mode: 'task_system',
				enable_sub_agents: true,
				enable_agent_teams: true,
			},
		},
		mountedResources: {
			tools: [{ name: 'knowledge_search' }],
		},
	});

	assert.deepEqual(pool.tools, ['bash', { name: 'knowledge_search' }, 'get_current_time']);
	assert.deepEqual(pool.removedToolNames, ['sub_agent', 'spawn_teammate', 'send_team_message', 'write_todos']);
});

test('sub-agent runtime strips every orchestration and team tool', () => {
	const pool = assembleToolPool({
		baseTools: [
			'bash',
			'sub_agent',
			'write_todos',
			'spawn_teammate',
			'send_team_message',
			'check_team_inbox',
			{ name: 'custom_tool' },
		],
		features: {
			task_orchestration: {
				enabled: true,
				mode: 'task_system',
				enable_sub_agents: true,
				enable_agent_teams: true,
			},
		},
		runtimeRole: 'sub_agent',
	});

	assert.deepEqual(pool.tools, ['bash', { name: 'custom_tool' }, 'get_current_time']);
});

test('teammate runtime keeps atomic tools and team communication only', () => {
	const pool = assembleToolPool({
		baseTools: ['bash', 'write_todos', 'spawn_teammate', 'check_team_inbox', { name: 'custom_tool' }],
		features: {
			task_orchestration: {
				enabled: true,
				mode: 'task_system',
				enable_agent_teams: true,
			},
		},
		runtimeRole: 'teammate',
	});

	assert.deepEqual(pool.tools, ['bash', { name: 'custom_tool' }, 'send_team_message', 'get_current_time']);
});

test('reviewer runtime is read-only and verifier runtime keeps write tools for fixtures', () => {
	const baseTools = ['bash', 'read_file', 'write_file', 'run_command', 'sub_agent', 'spawn_teammate'];

	assert.deepEqual(
		assembleToolPool({ baseTools, runtimeRole: 'reviewer' }).tools,
		['bash', 'read_file', 'get_current_time'],
	);
	assert.deepEqual(
		assembleToolPool({ baseTools, runtimeRole: 'verifier' }).tools,
		['bash', 'read_file', 'write_file', 'get_current_time'],
	);
});

test('filterToolsForRuntimeRole can filter an existing pool without mutating it', () => {
	const pool = assembleToolPool({
		baseTools: ['bash', 'write_todos', 'spawn_teammate', 'send_team_message'],
		features: {
			task_orchestration: {
				enabled: true,
				mode: 'todo',
				enable_agent_teams: true,
			},
		},
	});

	const filtered = filterToolsForRuntimeRole(pool, 'teammate');

	assert.deepEqual(filtered.tools, ['bash', 'send_team_message', 'get_current_time']);
	assert.notEqual(filtered, pool);
	assert.equal(pool.runtimeRole, 'lead');
	assert.equal(filtered.runtimeRole, 'teammate');
});

test('describeToolPool returns a compact Context Inspector summary', () => {
	const pool = assembleToolPool({
		baseTools: ['bash', 'sub_agent'],
		features: {
			task_orchestration: {
				enabled: true,
				mode: 'task_system',
				enable_sub_agents: true,
			},
		},
		runtimeRole: 'lead',
		strategyId: 'sequential_subagent',
	});
	const summary = describeToolPool(pool);

	assert.deepEqual(summary, {
		runtimeRole: 'lead',
		strategyId: 'sequential_subagent',
		count: 8,
		names: [
			'bash',
			'create_task',
			'list_tasks',
			'get_task',
			'claim_task',
			'complete_task',
			'sub_agent',
			'get_current_time',
		],
		added: [
			'create_task',
			'list_tasks',
			'get_task',
			'claim_task',
			'complete_task',
			'get_current_time',
		],
		removed: ['sub_agent'],
		orchestration: {
			enabled: true,
			mode: 'task_system',
			subAgents: true,
			backgroundTasks: false,
			agentTeams: false,
			cronScheduler: false,
		},
	});
});

test('getToolName handles strings, object tools, and invalid values', () => {
	assert.equal(getToolName('bash'), 'bash');
	assert.equal(getToolName({ name: 'read_file' }), 'read_file');
	assert.equal(getToolName(null), '');
	assert.equal(getToolName(42), '');
});
