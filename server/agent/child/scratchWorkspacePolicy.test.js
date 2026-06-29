import test from 'node:test';
import assert from 'node:assert/strict';

import {
	createScratchWorkspacePolicy,
	isPathInsideScratch,
} from './scratchWorkspacePolicy.js';

test('createScratchWorkspacePolicy sanitizes run and child ids into workspace-relative paths', () => {
	const policy = createScratchWorkspacePolicy({
		runId: 'run/1',
		childId: 'child:2',
		rootDir: '/workspace/app',
	});

	assert.equal(policy.enabled, true);
	assert.equal(policy.relativePath, '.agent-scratch/run_1/child_2');
	assert.equal(policy.absolutePath, '/workspace/app/.agent-scratch/run_1/child_2');
	assert.match(policy.instruction, /\.agent-scratch\/run_1\/child_2/);
});

test('isPathInsideScratch accepts only paths under the scratch directory', () => {
	const policy = createScratchWorkspacePolicy({
		runId: 'run/1',
		childId: 'child:2',
		rootDir: '/workspace/app',
	});

	assert.equal(isPathInsideScratch('.agent-scratch/run_1/child_2/tmp.js', policy), true);
	assert.equal(isPathInsideScratch('/workspace/app/.agent-scratch/run_1/child_2/tmp.js', policy), true);
	assert.equal(isPathInsideScratch('/workspace/app/.agent-scratch/run_1/child_20/tmp.js', policy), false);
	assert.equal(isPathInsideScratch('/tmp/tmp.js', policy), false);
	assert.equal(isPathInsideScratch('../app/.agent-scratch/run_1/child_2/tmp.js', policy), true);
	assert.equal(isPathInsideScratch('../outside/tmp.js', policy), false);
});
