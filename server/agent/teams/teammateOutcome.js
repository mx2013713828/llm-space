import { buildChildOutcome } from '../child/childOutcome.js';

export function buildTeammateOutcome({ messages = [], stopReason = '' } = {}) {
	return buildChildOutcome({
		messages,
		stopReason,
		childLabel: 'Teammate',
	});
}
