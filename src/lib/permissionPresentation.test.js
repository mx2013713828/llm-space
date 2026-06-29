import test from 'node:test';
import assert from 'node:assert/strict';

import {
	normalizePermissionPayload,
	getPermissionSourcePresentation,
} from './permissionPresentation.js';

test('normalizes child permission metadata from teammate events', () => {
	const payload = normalizePermissionPayload({
		toolCallId: 'tool_write',
		toolName: 'write_file',
		toolInput: { path: '/tmp/outside.txt' },
		reason: '越界写入',
		runtimeRole: 'teammate',
		childType: 'teammate',
		childId: 'teammate_backend',
		name: 'backend-checker',
		role: 'Backend reviewer',
		parentToolCallId: 'tool_spawn',
		teamId: 'team_1',
		teammateId: 'teammate_backend',
		teammateName: 'backend-checker',
		teammateRole: 'Backend reviewer',
	});

	assert.deepEqual(payload, {
		toolCallId: 'tool_write',
		toolName: 'write_file',
		toolInput: { path: '/tmp/outside.txt' },
		reason: '越界写入',
		runtimeRole: 'teammate',
		childType: 'teammate',
		childId: 'teammate_backend',
		name: 'backend-checker',
		role: 'Backend reviewer',
		parentToolCallId: 'tool_spawn',
		teamId: 'team_1',
		teammateId: 'teammate_backend',
		teammateName: 'backend-checker',
		teammateRole: 'Backend reviewer',
	});
});

test('formats teammate and sub-agent permission source labels', () => {
	assert.deepEqual(
		getPermissionSourcePresentation({
			runtimeRole: 'teammate',
			teammateName: 'backend-checker',
			teammateRole: 'Backend reviewer',
		}),
		{
			visible: true,
			label: 'Teammate',
			title: 'backend-checker',
			detail: 'Backend reviewer',
			tone: 'blue',
		},
	);

	assert.deepEqual(
		getPermissionSourcePresentation({
			runtimeRole: 'sub_agent',
			childId: 'tool_123',
			parentToolCallId: 'tool_parent',
		}),
		{
			visible: true,
			label: 'Sub-agent',
			title: 'tool_123',
			detail: 'Parent tool: tool_parent',
			tone: 'purple',
		},
	);
});

test('falls back to lead agent source when permission has no child metadata', () => {
	assert.deepEqual(
		getPermissionSourcePresentation({ runtimeRole: 'lead' }),
		{
			visible: false,
			label: 'Lead agent',
			title: 'Lead agent',
			detail: '',
			tone: 'neutral',
		},
	);
});
