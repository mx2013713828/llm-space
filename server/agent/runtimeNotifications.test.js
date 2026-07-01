import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createRuntimeNotificationPlugin,
	createRuntimeNotificationQueue,
	drainRuntimeNotifications,
	enqueueRuntimeNotification,
	formatNotificationsForLlm,
	injectRuntimeNotificationBlocks,
	peekRuntimeNotifications,
	summarizeNotificationsForUi,
} from './runtimeNotifications.js';

test('runtime notification queue dedupes, bounds, and drains by priority', () => {
	const queue = createRuntimeNotificationQueue({ maxPerHarness: 3 });

	enqueueRuntimeNotification({
		harnessId: 'h1',
		source: 'team',
		type: 'team_inbox',
		payload: { text: 'first' },
		dedupeKey: 'same',
		priority: 1,
	}, queue);
	enqueueRuntimeNotification({
		harnessId: 'h1',
		source: 'team',
		type: 'team_inbox',
		payload: { text: 'duplicate ignored' },
		dedupeKey: 'same',
		priority: 5,
	}, queue);
	enqueueRuntimeNotification({ harnessId: 'h1', source: 'cron', type: 'scheduled_prompt', payload: { text: 'second' }, priority: 3 }, queue);
	enqueueRuntimeNotification({ harnessId: 'h1', source: 'background', type: 'task_result', payload: { text: 'third' }, priority: 2 }, queue);
	enqueueRuntimeNotification({ harnessId: 'h1', source: 'memory', type: 'candidate', payload: { text: 'fourth' }, priority: 0 }, queue);

	assert.deepEqual(
		peekRuntimeNotifications({ harnessId: 'h1', queue }).map(item => item.payload.text),
		['second', 'third', 'fourth'],
	);

	const drained = drainRuntimeNotifications({ harnessId: 'h1', limit: 2, queue });
	assert.deepEqual(drained.map(item => item.payload.text), ['second', 'third']);
	assert.deepEqual(
		peekRuntimeNotifications({ harnessId: 'h1', queue }).map(item => item.payload.text),
		['fourth'],
	);
});

test('runtime notification previews do not consume unread notifications', () => {
	const queue = createRuntimeNotificationQueue();
	enqueueRuntimeNotification({ harnessId: 'h1', source: 'team', type: 'team_inbox', payload: { text: 'Review complete.' } }, queue);
	enqueueRuntimeNotification({ harnessId: 'h1', source: 'cron', type: 'scheduled_prompt', payload: { text: 'Run weather task.' } }, queue);

	const preview = summarizeNotificationsForUi(peekRuntimeNotifications({ harnessId: 'h1', queue }));

	assert.equal(preview.unreadCount, 2);
	assert.deepEqual(preview.bySource, { team: 1, cron: 1 });
	assert.deepEqual(preview.previews.map(item => item.label), ['team:team_inbox', 'cron:scheduled_prompt']);
	assert.equal(peekRuntimeNotifications({ harnessId: 'h1', queue }).length, 2);
});

test('runtime notifications format as one source-labeled LLM block', () => {
	const blocks = formatNotificationsForLlm([
		{
			id: 'rn_1',
			source: 'team',
			type: 'team_inbox',
			payload: { text: '<team_inbox>\n- from=teammate text=Done\n</team_inbox>' },
		},
		{
			id: 'rn_2',
			source: 'cron',
			type: 'scheduled_prompt',
			payload: { text: '<scheduled_trigger>Run weather task.</scheduled_trigger>' },
		},
	]);

	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, 'text');
	assert.match(blocks[0].text, /<runtime_notifications>/);
	assert.match(blocks[0].text, /source="team" type="team_inbox"/);
	assert.match(blocks[0].text, /<team_inbox>/);
	assert.match(blocks[0].text, /source="cron" type="scheduled_prompt"/);
});

test('runtime notification injection respects tool_result message boundaries', () => {
	const blocks = formatNotificationsForLlm([
		{ harnessId: 'h1', source: 'team', type: 'team_inbox', payload: { text: 'hello' } },
	]);
	const apiMessages = [
		{
			role: 'user',
			content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'ok' }],
		},
	];

	injectRuntimeNotificationBlocks(apiMessages, blocks);

	assert.equal(apiMessages.length, 2);
	assert.equal(apiMessages[1].role, 'user');
	assert.match(apiMessages[1].content[0].text, /<runtime_notifications>/);
});

test('runtime notification plugin drains queued notifications into preLLM context', async () => {
	const queue = createRuntimeNotificationQueue();
	const plugin = createRuntimeNotificationPlugin({ queue, drainLimit: 4 });
	enqueueRuntimeNotification({ harnessId: 'h1', source: 'team', type: 'team_inbox', payload: { text: 'Done.' } }, queue);

	const events = [];
	const context = {
		executor: { harnessId: 'h1', onEvent: (type, payload) => events.push({ type, payload }) },
		apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize.' }] }],
	};

	await plugin.preLLM(context);

	assert.match(context.apiMessages[0].content[0].text, /Done\./);
	assert.equal(peekRuntimeNotifications({ harnessId: 'h1', queue }).length, 0);
	assert.equal(context.runtimeNotificationSummary.unreadCount, 1);
	assert.equal(events[0].type, 'runtime_notifications_drained');
	assert.equal(events[0].payload.unreadCount, 1);
});
