import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { AgentExecutor } from '../AgentExecutor.js';
import { createRunController } from './runController.js';

async function withTempCwd(prefix, fn) {
	const originalCwd = process.cwd();
	const rootDir = await mkdtemp(path.join(tmpdir(), prefix));
	await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
	process.chdir(rootDir);
	try {
		return await fn(rootDir);
	} finally {
		process.chdir(originalCwd);
		await rm(rootDir, { recursive: true, force: true });
	}
}

async function waitFor(predicate, timeoutMs = 500) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 5));
	}
	throw new Error('Timed out waiting for runtime checkpoint');
}

function createExecutor({ runController, harnessId = 'step-through' } = {}) {
	return new AgentExecutor({
		harnessId,
		messages: [{ role: 'user', turn: 1, content: 'What time is it?' }],
		tools: ['get_current_time'],
		model: { id: 'test', modelId: 'test', key: 'test', url: 'https://example.invalid' },
		runController,
	});
}

test('step-through pauses before a tool batch and after its result', async () => {
	await withTempCwd('step-through-executor-', async () => {
		const controller = createRunController({ mode: 'step_through' });
		const executor = createExecutor({ runController: controller });
		let calls = 0;
		executor._callLLM = async (context) => {
			calls += 1;
			if (calls === 1) {
				executor.messages.push({
					role: 'assistant',
					type: 'tool_call',
					turn: context.turnIndex,
					id: 'toolu_time',
					toolName: 'get_current_time',
					toolInput: {},
				});
				return 'tool_use';
			}
			executor.messages.push({
				role: 'assistant',
				type: 'text',
				turn: context.turnIndex,
				content: 'Final answer.',
			});
			return 'end_turn';
		};

		const running = executor.run(2);
		await waitFor(() => controller.getState().checkpoint?.phase === 'awaiting_tool_step');
		assert.deepEqual(controller.getState().checkpoint.tools, [{ id: 'toolu_time', name: 'get_current_time' }]);
		controller.advance({ action: 'next' });

		await waitFor(() => controller.getState().checkpoint?.phase === 'awaiting_model_step');
		controller.advance({ action: 'next' });
		await running;

		assert.equal(calls, 2);
		assert.equal(executor.messages.find(message => message.id === 'toolu_time')?.toolStatus, 'completed');
		assert.equal(executor.messages.findLast(message => message.type === 'text')?.content, 'Final answer.');
	});
});

test('final model text does not create a step checkpoint', async () => {
	await withTempCwd('step-through-final-', async () => {
		const controller = createRunController({ mode: 'step_through' });
		const executor = createExecutor({ runController: controller, harnessId: 'step-through-final' });
		executor._callLLM = async (context) => {
			executor.messages.push({
				role: 'assistant',
				type: 'text',
				turn: context.turnIndex,
				content: 'Final answer.',
			});
			return 'end_turn';
		};

		await executor.run(1);
		assert.equal(controller.getState().checkpoint, null);
		assert.equal(controller.getState().status, 'running');
	});
});

test('aborting at the tool checkpoint stops before executing the tool', async () => {
	await withTempCwd('step-through-abort-', async () => {
		const controller = createRunController({ mode: 'step_through' });
		const executor = createExecutor({ runController: controller, harnessId: 'step-through-abort' });
		executor._callLLM = async (context) => {
			executor.messages.push({
				role: 'assistant',
				type: 'tool_call',
				turn: context.turnIndex,
				id: 'toolu_abort',
				toolName: 'get_current_time',
				toolInput: {},
			});
			return 'tool_use';
		};

		const running = executor.run(1);
		await waitFor(() => controller.getState().checkpoint?.phase === 'awaiting_tool_step');
		controller.abort();
		await running;

		assert.equal(executor.messages.find(message => message.id === 'toolu_abort')?.toolStatus, undefined);
		assert.equal(controller.getState().status, 'aborted');
	});
});
