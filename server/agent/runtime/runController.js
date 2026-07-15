const TERMINAL_STATUSES = new Set(['aborted', 'interrupted']);

function normalizeMode(mode) {
	return mode === 'step_through' ? 'step_through' : 'continuous';
}

function cloneCheckpoint(checkpoint) {
	if (!checkpoint) return null;
	return {
		...checkpoint,
		nextAction: checkpoint.nextAction ? { ...checkpoint.nextAction } : null,
		tools: Array.isArray(checkpoint.tools) ? checkpoint.tools.map(tool => ({ ...tool })) : [],
	};
}

export function createRunController({ mode = 'continuous', onStateChange = () => {} } = {}) {
	let runMode = normalizeMode(mode);
	let state = { mode: runMode, status: 'running', checkpoint: null };
	let resolveWait = null;

	const publish = () => onStateChange({
		...state,
		checkpoint: cloneCheckpoint(state.checkpoint),
	});

	const getState = () => ({
		...state,
		checkpoint: cloneCheckpoint(state.checkpoint),
	});

	const settleWait = (result, nextState) => {
		const resolve = resolveWait;
		resolveWait = null;
		state = nextState;
		publish();
		resolve?.(result);
	};

	return {
		getState,
		async waitForCheckpoint(checkpoint) {
			if (runMode === 'continuous' || TERMINAL_STATUSES.has(state.status)) return null;
			if (resolveWait) return null;
			state = {
				mode: runMode,
				status: 'paused',
				checkpoint: cloneCheckpoint(checkpoint),
			};
			publish();
			return new Promise(resolve => {
				resolveWait = resolve;
			});
		},
		advance({ action } = {}) {
			if (!resolveWait || !['next', 'run_to_completion'].includes(action)) return false;
			if (action === 'run_to_completion') runMode = 'continuous';
			settleWait({ action }, {
				mode: runMode,
				status: 'running',
				checkpoint: null,
			});
			return true;
		},
		abort() {
			if (!resolveWait || TERMINAL_STATUSES.has(state.status)) return false;
			settleWait({ action: 'abort' }, {
				mode: runMode,
				status: 'aborted',
				checkpoint: null,
			});
			return true;
		},
		markInterrupted() {
			if (TERMINAL_STATUSES.has(state.status)) return false;
			resolveWait = null;
			state = {
				mode: runMode,
				status: 'interrupted',
				checkpoint: null,
			};
			publish();
			return true;
		},
	};
}
