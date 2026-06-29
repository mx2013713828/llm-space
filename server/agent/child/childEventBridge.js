const DEFAULT_TEXT_PREVIEW_LIMIT = 6000;
const DEFAULT_TOOL_OUTPUT_PREVIEW_LIMIT = 8000;

function buildChildSourceMetadata({
	childType,
	childId,
	name,
	role,
	parentToolCallId,
	teamId,
}) {
	const metadata = {
		runtimeRole: childType,
		childType,
		childId,
		name: name ?? null,
		role: role ?? null,
		parentToolCallId,
		teamId,
	};

	if (childType === 'teammate') {
		metadata.teammateId = childId;
		metadata.teammateName = name ?? null;
		metadata.teammateRole = role ?? null;
	}

	return Object.fromEntries(
		Object.entries(metadata).filter(([, value]) => value !== undefined),
	);
}

export function createChildEventBridge({
	parentExecutor,
	childType,
	childId,
	name = null,
	role = null,
	parentToolCallId = null,
	teamId = null,
	startedAt = null,
	onStatus = null,
	forwardEvents = [],
	textPreviewLimit = DEFAULT_TEXT_PREVIEW_LIMIT,
	toolOutputPreviewLimit = DEFAULT_TOOL_OUTPUT_PREVIEW_LIMIT,
} = {}) {
	const passthroughEvents = new Set(forwardEvents);
	const sourceMetadata = buildChildSourceMetadata({
		childType,
		childId,
		name,
		role,
		parentToolCallId,
		teamId,
	});
	let toolCount = 0;
	let previewTruncated = false;

	const emitStatus = (patch = {}) => {
		if (typeof onStatus !== 'function') return;
		onStatus({
			status: 'running',
			phase: 'running',
			toolCount,
			previewTruncated,
			startedAt,
			...patch,
		});
	};

	return (type, payload = {}) => {
		if (passthroughEvents.has(type)) {
			parentExecutor?.onEvent?.(type, payload);
			return;
		}

		if (type === 'permission_request') {
			const bridgedPayload = {
				...payload,
				...sourceMetadata,
			};
			parentExecutor.pendingPermission = bridgedPayload;
			parentExecutor?.onEvent?.(type, bridgedPayload);
			return;
		}

		if (type === 'permission_resolved') {
			if (parentExecutor.pendingPermission?.toolCallId === payload?.toolCallId) {
				parentExecutor.pendingPermission = null;
			}
			parentExecutor?.onEvent?.(type, {
				...payload,
				...sourceMetadata,
			});
			return;
		}

		if (type === 'messages_update') {
			return;
		}

		if (type === 'thinking_start') {
			emitStatus({ phase: 'thinking', currentAction: 'thinking' });
			return;
		}

		if (type === 'text_start') {
			emitStatus({ phase: 'finalizing', currentAction: 'writing final answer' });
			return;
		}

		if (type === 'tool_start') {
			toolCount += 1;
			emitStatus({
				phase: 'tool_use',
				currentAction: payload.name ? `calling ${payload.name}` : 'calling tool',
				currentTool: payload.name || '',
			});
			return;
		}

		if (type === 'tool_exec_start') {
			emitStatus({
				phase: 'tool_use',
				currentAction: payload.toolName ? `executing ${payload.toolName}` : 'executing tool',
				currentTool: payload.toolName || '',
			});
			return;
		}

		if (type === 'tool_exec_done') {
			if (typeof payload.output === 'string' && payload.output.length > toolOutputPreviewLimit) {
				previewTruncated = true;
			}
			emitStatus({
				phase: 'tool_result',
				currentAction: payload.toolName ? `finished ${payload.toolName}` : 'received tool result',
			});
			return;
		}

		if ((type === 'thinking_delta' || type === 'text_delta') && String(payload.text || '').length > textPreviewLimit) {
			previewTruncated = true;
		}
	};
}
