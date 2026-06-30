function findLastAssistantTextEntry(entries) {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const message = entries[i];
		if (
			message?.role === 'assistant'
			&& message?.type === 'text'
			&& typeof message?.content === 'string'
			&& message.content.trim()
		) {
			return { index: i, content: message.content };
		}
	}

	return null;
}

function findLastToolEntry(entries) {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const message = entries[i];
		if (message?.role === 'assistant' && message?.type === 'tool_call') {
			return { index: i, toolName: message.toolName || '' };
		}
	}

	return null;
}

function buildNoResultOutcome({ entries, lastTool, error }) {
	return {
		status: 'no_result',
		content: '',
		error,
		lastToolName: lastTool?.toolName || null,
		messageCount: entries.length,
	};
}

export function buildChildOutcome({
	messages = [],
	stopReason = '',
	childLabel = 'Child agent',
	requireFinalText = true,
} = {}) {
	const entries = Array.isArray(messages) ? messages : [];
	const lastTool = findLastToolEntry(entries);
	const finalText = findLastAssistantTextEntry(entries);

	if (stopReason === 'cancelled') {
		return {
			status: 'cancelled',
			content: '',
			error: `${childLabel} was cancelled before producing a final answer.`,
			lastToolName: lastTool?.toolName || null,
			messageCount: entries.length,
		};
	}

	if (!requireFinalText) {
		return {
			status: 'completed',
			content: finalText?.content || '',
			error: null,
			lastToolName: lastTool?.toolName || null,
			messageCount: entries.length,
		};
	}

	if (!finalText || (lastTool && finalText.index <= lastTool.index)) {
		return buildNoResultOutcome({
			entries,
			lastTool,
			error: lastTool
				? `${childLabel} finished without a final text report after its last tool call.`
				: `${childLabel} finished without a final text report.`,
		});
	}

	return {
		status: 'completed',
		content: finalText.content,
		error: null,
		lastToolName: lastTool?.toolName || null,
		messageCount: entries.length,
	};
}
