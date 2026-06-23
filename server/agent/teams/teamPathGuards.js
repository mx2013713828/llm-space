import path from 'node:path';

const STORAGE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validateStorageId(kind, value) {
  if (typeof value !== 'string' || !STORAGE_ID_PATTERN.test(value)) {
    throw new Error(
      `Invalid ${kind}: expected a non-empty string containing only letters, numbers, underscore, and hyphen.`,
    );
  }

  return value;
}

export function ensureWithinRoot(rootDir, targetPath) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Resolved team path escapes the session root.');
  }

  return resolvedTarget;
}
