import test from 'node:test';
import assert from 'node:assert/strict';

import { createChildEventBridge } from './childEventBridge.js';

test('bridges child permission events with source metadata', () => {
	const events = [];
	const parentExecutor = {
		pendingPermission: null,
		onEvent(type, payload) {
			events.push({ type, payload });
		},
	};
	const bridge = createChildEventBridge({
		parentExecutor,
		childType: 'teammate',
		childId: 'teammate_backend',
		name: 'backend-checker',
		role: 'Backend reviewer',
		teamId: 'team_1',
		parentToolCallId: 'tool_spawn',
	});

	bridge('permission_request', {
		toolCallId: 'tool_write',
		toolName: 'write_file',
		toolInput: { path: '/tmp/outside.txt' },
		reason: '越界写入',
	});
	bridge('permission_resolved', {
		toolCallId: 'tool_write',
		toolName: 'write_file',
		decision: 'deny',
	});

	assert.equal(parentExecutor.pendingPermission, null);
	assert.equal(events[0].type, 'permission_request');
	assert.deepEqual(events[0].payload, {
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
	assert.equal(events[1].type, 'permission_resolved');
	assert.equal(events[1].payload.decision, 'deny');
	assert.equal(events[1].payload.childType, 'teammate');
	assert.equal(events[1].payload.teammateName, 'backend-checker');
});

test('maps sub-agent child events into bounded status patches', () => {
	const statusPatches = [];
	const parentExecutor = {
		onEvent() {
			throw new Error('raw child events should not be forwarded');
		},
	};
	const bridge = createChildEventBridge({
		parentExecutor,
		childType: 'sub_agent',
		childId: 'tool_sub',
		parentToolCallId: 'tool_sub',
		startedAt: '2026-06-29T00:00:00.000Z',
		onStatus(patch) {
			statusPatches.push(patch);
		},
	});

	bridge('messages_update', { messages: [{ content: 'hidden' }] });
	bridge('thinking_start', {});
	bridge('tool_start', { id: 'tool_child', name: 'bash' });
	bridge('tool_exec_done', { id: 'tool_child', toolName: 'bash', output: 'done' });

	assert.deepEqual(statusPatches, [
		{
			status: 'running',
			phase: 'thinking',
			currentAction: 'thinking',
			toolCount: 0,
			previewTruncated: false,
			startedAt: '2026-06-29T00:00:00.000Z',
		},
		{
			status: 'running',
			phase: 'tool_use',
			currentAction: 'calling bash',
			currentTool: 'bash',
			toolCount: 1,
			previewTruncated: false,
			startedAt: '2026-06-29T00:00:00.000Z',
		},
		{
			status: 'running',
			phase: 'tool_result',
			currentAction: 'finished bash',
			toolCount: 1,
			previewTruncated: false,
			startedAt: '2026-06-29T00:00:00.000Z',
		},
	]);
});

test('can passthrough selected child events such as team_update', () => {
	const events = [];
	const bridge = createChildEventBridge({
		parentExecutor: {
			onEvent(type, payload) {
				events.push({ type, payload });
			},
		},
		childType: 'teammate',
		childId: 'teammate_backend',
		forwardEvents: ['team_update'],
	});

	bridge('team_update', { teamId: 'team_1', teammates: [] });
	bridge('text_delta', { text: 'hidden child stream' });

	assert.deepEqual(events, [
		{
			type: 'team_update',
			payload: { teamId: 'team_1', teammates: [] },
		},
	]);
});
