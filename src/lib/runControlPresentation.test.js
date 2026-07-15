import test from 'node:test';
import assert from 'node:assert/strict';

import { getRunControlPresentation } from './runControlPresentation.js';

test('presents one stable next-step action and bounded tool chips', () => {
	assert.deepEqual(getRunControlPresentation({
		status: 'paused',
		checkpoint: {
			phase: 'awaiting_tool_step',
			nextAction: { description: 'Next: run 2 tools' },
			tools: [
				{ name: 'read_file' },
				{ name: 'mcp__context7__query_docs' },
				{ name: 'sub_agent' },
			],
		},
	}), {
		visible: true,
		phaseLabel: 'Awaiting next step',
		nextDescription: 'Next: run 2 tools',
		tools: ['read_file', 'mcp__context7__query_docs', 'sub_agent'],
		primaryLabel: 'Next step',
	});
});

test('hides malformed and non-paused run control states', () => {
	assert.deepEqual(getRunControlPresentation({ status: 'running' }), { visible: false });
	assert.deepEqual(getRunControlPresentation({
		status: 'paused',
		checkpoint: { nextAction: {} },
	}), { visible: false });
});
