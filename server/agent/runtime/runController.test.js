import test from 'node:test';
import assert from 'node:assert/strict';

import { createRunController } from './runController.js';

const toolCheckpoint = {
	phase: 'awaiting_tool_step',
	turn: 3,
	nextAction: { kind: 'tools', description: 'Next: run 2 tools' },
	tools: [{ name: 'read_file' }, { name: 'mcp__context7__query_docs' }],
};

test('step-through waits for next and publishes a bounded tool checkpoint', async () => {
	const states = [];
	const controller = createRunController({
		mode: 'step_through',
		onStateChange: state => states.push(state),
	});
	const waiting = controller.waitForCheckpoint(toolCheckpoint);

	assert.equal(controller.getState().status, 'paused');
	assert.equal(controller.getState().checkpoint.tools.length, 2);
	assert.equal(controller.advance({ action: 'next' }), true);
	assert.deepEqual(await waiting, { action: 'next' });
	assert.equal(states.at(-1).status, 'running');
});

test('continuous controller never waits', async () => {
	const controller = createRunController({ mode: 'continuous' });
	assert.equal(await controller.waitForCheckpoint(toolCheckpoint), null);
	assert.equal(controller.getState().status, 'running');
});

test('run to completion resolves this checkpoint and disables later waits', async () => {
	const controller = createRunController({ mode: 'step_through' });
	const firstWait = controller.waitForCheckpoint(toolCheckpoint);

	assert.equal(controller.advance({ action: 'run_to_completion' }), true);
	assert.deepEqual(await firstWait, { action: 'run_to_completion' });
	assert.equal(await controller.waitForCheckpoint({ ...toolCheckpoint, phase: 'awaiting_model_step' }), null);
	assert.equal(controller.getState().mode, 'continuous');
});

test('abort resolves a paused checkpoint and stale commands are ignored', async () => {
	const controller = createRunController({ mode: 'step_through' });
	const waiting = controller.waitForCheckpoint(toolCheckpoint);

	assert.equal(controller.abort(), true);
	assert.deepEqual(await waiting, { action: 'abort' });
	assert.equal(controller.advance({ action: 'next' }), false);
	assert.equal(controller.getState().status, 'aborted');
});

test('interrupted controller rejects later checkpoint progress', async () => {
	const controller = createRunController({ mode: 'step_through' });
	controller.markInterrupted();

	assert.equal(controller.getState().status, 'interrupted');
	assert.equal(await controller.waitForCheckpoint(toolCheckpoint), null);
	assert.equal(controller.advance({ action: 'next' }), false);
});
