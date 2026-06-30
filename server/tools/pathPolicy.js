import path from 'node:path';

const SENSITIVE_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx']);

function getWorkspaceRoot(rootDir = process.cwd()) {
  return path.resolve(rootDir);
}

function isInsideOrEqualPath(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function isSensitivePath(targetPath) {
  const basename = path.basename(targetPath);
  const extname = path.extname(targetPath).toLowerCase();

  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    SENSITIVE_EXTENSIONS.has(extname)
  );
}

export function resolveToolPath(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Missing parameter: path or filePath');
  }

  const rootPath = getWorkspaceRoot(options.rootDir);
  const targetPath = path.resolve(rootPath, filePath);

  if (!isInsideOrEqualPath(rootPath, targetPath)) {
    throw new Error('Access denied: path is outside the workspace.');
  }

  if (isSensitivePath(targetPath)) {
    throw new Error('Access denied: sensitive files cannot be accessed by this tool.');
  }

  return targetPath;
}

export function resolveToolPathForRead(filePath, options) {
  return resolveToolPath(filePath, options);
}

export function resolveToolPathForWrite(filePath, options) {
  return resolveToolPath(filePath, options);
}
