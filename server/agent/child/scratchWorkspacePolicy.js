import path from 'node:path';

const SCRATCH_ROOT = '.agent-scratch';

function sanitizeSegment(value, fallback) {
	const sanitized = String(value || '')
		.replace(/[^A-Za-z0-9_-]/g, '_')
		.replace(/_+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 80);
	return sanitized || fallback;
}

export function createScratchWorkspacePolicy({
	runId,
	childId,
	rootDir = process.cwd(),
} = {}) {
	const safeRunId = sanitizeSegment(runId, 'run');
	const safeChildId = sanitizeSegment(childId, 'child');
	const relativePath = path.posix.join(SCRATCH_ROOT, safeRunId, safeChildId);
	const absolutePath = path.resolve(rootDir, relativePath);

	return {
		enabled: true,
		rootDir,
		relativePath,
		absolutePath,
		instruction: `Use ${relativePath} for temporary verification files, fixtures, or scripts. Keep scratch writes auditable and avoid /tmp or paths outside the workspace.`,
	};
}

export function isPathInsideScratch(filePath, scratchPolicy) {
	if (!scratchPolicy?.enabled || !filePath) return false;

	const rootDir = scratchPolicy.rootDir || process.cwd();
	const scratchRoot = path.resolve(rootDir, scratchPolicy.relativePath);
	const targetPath = path.resolve(rootDir, filePath);
	const relative = path.relative(scratchRoot, targetPath);

	return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
