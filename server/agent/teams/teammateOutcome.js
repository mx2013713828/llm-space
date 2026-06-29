import { buildChildOutcome } from '../child/childOutcome.js';

export function buildTeammateOutcome({ messages = [], stopReason = '', maxTurns = 8 } = {}) {
	return buildChildOutcome({
		messages,
		stopReason,
		childLabel: 'Teammate',
		legacyMaxTurns: maxTurns,
	});
}
