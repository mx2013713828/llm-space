const DEFAULT_MAX_PER_HARNESS = 50;
const DEFAULT_DRAIN_LIMIT = 8;
const PREVIEW_LIMIT = 240;

let nextSequence = 0;

function normalizeHarnessId(harnessId) {
	const value = String(harnessId || '').trim();
	if (!value) {
		throw new Error('runtime notification requires harnessId.');
	}
	return value;
}

function escapeXml(value) {
	return String(value ?? '')
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function getPayloadText(payload) {
	if (typeof payload === 'string') return payload;
	if (typeof payload?.text === 'string') return payload.text;
	if (typeof payload?.message === 'string') return payload.message;
	if (typeof payload?.content === 'string') return payload.content;
	if (payload == null) return '';
	return JSON.stringify(payload);
}

function makeDedupeKey(notification) {
	if (notification.dedupeKey) return String(notification.dedupeKey);
	return [
		notification.harnessId,
		notification.source || 'runtime',
		notification.type || 'notification',
		getPayloadText(notification.payload),
	].join(':');
}

function cloneNotification(notification) {
	return {
		...notification,
		payload: typeof notification.payload === 'object' && notification.payload !== null
			? { ...notification.payload }
			: notification.payload,
	};
}

export function createRuntimeNotificationQueue({ maxPerHarness = DEFAULT_MAX_PER_HARNESS } = {}) {
	return {
		maxPerHarness,
		byHarness: new Map(),
	};
}

export const defaultRuntimeNotificationQueue = createRuntimeNotificationQueue();

function resolveQueue(queue) {
	return queue || defaultRuntimeNotificationQueue;
}

export function enqueueRuntimeNotification(notification = {}, queue = defaultRuntimeNotificationQueue) {
	const targetQueue = resolveQueue(queue);
	const harnessId = normalizeHarnessId(notification.harnessId);
	const now = new Date().toISOString();
	const item = {
		id: notification.id || `rn_${Date.now().toString(36)}_${nextSequence.toString(36)}`,
		harnessId,
		source: String(notification.source || 'runtime'),
		type: String(notification.type || 'notification'),
		payload: notification.payload ?? {},
		priority: Number.isFinite(Number(notification.priority)) ? Number(notification.priority) : 0,
		createdAt: notification.createdAt || now,
		dedupeKey: makeDedupeKey({ ...notification, harnessId }),
		sequence: nextSequence++,
	};

	const existing = targetQueue.byHarness.get(harnessId) || [];
	if (existing.some(entry => entry.dedupeKey === item.dedupeKey)) {
		return null;
	}

	const nextItems = [...existing, item];
	while (nextItems.length > targetQueue.maxPerHarness) {
		nextItems.shift();
	}
	targetQueue.byHarness.set(harnessId, nextItems);
	return cloneNotification(item);
}

function sortedForDelivery(items) {
	return [...items].sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		return a.sequence - b.sequence;
	});
}

export function peekRuntimeNotifications({ harnessId, limit = Number.POSITIVE_INFINITY, queue = defaultRuntimeNotificationQueue } = {}) {
	const targetQueue = resolveQueue(queue);
	const id = normalizeHarnessId(harnessId);
	return sortedForDelivery(targetQueue.byHarness.get(id) || [])
		.slice(0, limit)
		.map(cloneNotification);
}

export function drainRuntimeNotifications({ harnessId, limit = DEFAULT_DRAIN_LIMIT, queue = defaultRuntimeNotificationQueue } = {}) {
	const targetQueue = resolveQueue(queue);
	const id = normalizeHarnessId(harnessId);
	const items = targetQueue.byHarness.get(id) || [];
	if (items.length === 0) return [];

	const sorted = sortedForDelivery(items);
	const drained = sorted.slice(0, limit);
	const drainedIds = new Set(drained.map(item => item.id));
	const remaining = items.filter(item => !drainedIds.has(item.id));
	if (remaining.length > 0) {
		targetQueue.byHarness.set(id, remaining);
	} else {
		targetQueue.byHarness.delete(id);
	}
	return drained.map(cloneNotification);
}

export function formatNotificationsForLlm(notifications = []) {
	const items = Array.isArray(notifications) ? notifications : [];
	if (items.length === 0) return [];

	const lines = ['<runtime_notifications>'];
	for (const item of items) {
		lines.push(`<runtime_notification id="${escapeXml(item.id || '')}" source="${escapeXml(item.source || 'runtime')}" type="${escapeXml(item.type || 'notification')}">`);
		lines.push(getPayloadText(item.payload));
		lines.push('</runtime_notification>');
	}
	lines.push('</runtime_notifications>');
	return [{ type: 'text', text: lines.join('\n') }];
}

export function injectRuntimeNotificationBlocks(apiMessages = [], blocks = []) {
	if (!Array.isArray(apiMessages) || !Array.isArray(blocks) || blocks.length === 0) return;

	const lastApiMsg = apiMessages[apiMessages.length - 1];
	const hasToolResult = lastApiMsg
		&& lastApiMsg.role === 'user'
		&& Array.isArray(lastApiMsg.content)
		&& lastApiMsg.content.some(entry => entry.type === 'tool_result');

	if (lastApiMsg && lastApiMsg.role === 'user' && !hasToolResult && Array.isArray(lastApiMsg.content)) {
		lastApiMsg.content.unshift(...blocks);
		return;
	}

	apiMessages.push({
		role: 'user',
		content: blocks,
	});
}

export function summarizeNotificationsForUi(notifications = []) {
	const items = Array.isArray(notifications) ? notifications : [];
	const bySource = {};
	const byType = {};
	const previews = [];

	for (const item of items) {
		const source = item.source || 'runtime';
		const type = item.type || 'notification';
		bySource[source] = (bySource[source] || 0) + 1;
		byType[type] = (byType[type] || 0) + 1;
		const text = getPayloadText(item.payload);
		previews.push({
			id: item.id,
			source,
			type,
			label: `${source}:${type}`,
			text: text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}...` : text,
			truncated: text.length > PREVIEW_LIMIT,
		});
	}

	return {
		unreadCount: items.length,
		bySource,
		byType,
		previews,
	};
}

function getNotificationHarnessIds(executor) {
	return [
		executor?.teamContext?.harnessId,
		executor?.harnessId,
	].filter((value, index, values) => value && values.indexOf(value) === index);
}

export function createRuntimeNotificationPlugin({
	queue = defaultRuntimeNotificationQueue,
	drainLimit = DEFAULT_DRAIN_LIMIT,
} = {}) {
	return {
		name: 'RuntimeNotificationPlugin',

		async preLLM(context) {
			const { executor, apiMessages } = context;
			const harnessIds = getNotificationHarnessIds(executor);
			if (!harnessIds.length) return;

			const drained = [];
			for (const harnessId of harnessIds) {
				drained.push(...drainRuntimeNotifications({ harnessId, limit: drainLimit, queue }));
			}

			if (!drained.length) {
				context.runtimeNotificationSummary = summarizeNotificationsForUi([]);
				return;
			}

			const blocks = formatNotificationsForLlm(drained);
			injectRuntimeNotificationBlocks(apiMessages, blocks);
			const summary = summarizeNotificationsForUi(drained);
			context.runtimeNotificationSummary = summary;
			executor?.onEvent?.('runtime_notifications_drained', summary);
		},
	};
}

export const RuntimeNotificationPlugin = createRuntimeNotificationPlugin();
