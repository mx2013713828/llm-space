import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isSensitivePath } from './pathPolicy.js';

const SKIPPED_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'coverage',
  'dist',
  'build',
  'node_modules',
  'server/sessions',
]);

const MAX_SCAN_DEPTH = 5;
const MAX_REDACTION_FILE_BYTES = 64 * 1024;
const DEFAULT_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';
const BASH_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM_PROGRAM',
  'NVM_DIR',
  'PNPM_HOME',
  'VOLTA_HOME',
  'JAVA_HOME',
];

function shellProfileQuote(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function isSkippedDir(rootPath, dirPath) {
  const relative = path.relative(rootPath, dirPath);
  return SKIPPED_DIRS.has(relative) || SKIPPED_DIRS.has(path.basename(dirPath));
}

export function listSensitiveWorkspacePaths(rootDir = process.cwd()) {
  const rootPath = path.resolve(rootDir);
  const results = [];

  function visit(dirPath, depth) {
    if (depth > MAX_SCAN_DEPTH || isSkippedDir(rootPath, dirPath)) return;

    let entries = [];
    try {
      entries = readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (isSensitivePath(entryPath)) {
        results.push(entryPath);
        continue;
      }

      if (entry.isDirectory()) {
        visit(entryPath, depth + 1);
      }
    }
  }

  visit(rootPath, 0);
  return results;
}

function commonHomeSensitivePaths() {
  const homeDir = os.homedir();
  if (!homeDir) return [];

  return [
    { type: 'subpath', value: path.join(homeDir, '.ssh') },
    { type: 'subpath', value: path.join(homeDir, '.aws') },
    { type: 'subpath', value: path.join(homeDir, '.config', 'gcloud') },
    { type: 'literal', value: path.join(homeDir, '.netrc') },
    { type: 'literal', value: path.join(homeDir, '.npmrc') },
    { type: 'literal', value: path.join(homeDir, '.git-credentials') },
    { type: 'literal', value: path.join(homeDir, '.docker', 'config.json') },
  ].filter(item => existsSync(item.value));
}

export function buildBashSandboxProfile(rootDir = process.cwd()) {
  const deniedEntries = [
    ...listSensitiveWorkspacePaths(rootDir).map(value => ({ type: 'literal', value })),
    ...commonHomeSensitivePaths(),
  ];

  if (deniedEntries.length === 0) {
    return null;
  }

  const deniedRules = deniedEntries
    .map(entry => `(${entry.type} "${shellProfileQuote(entry.value)}")`)
    .join('\n    ');

  return `(version 1)
(allow default)
(deny file-read*
    ${deniedRules}
)`;
}

export function isBashSandboxAvailable() {
  return process.platform === 'darwin' && existsSync(DEFAULT_SANDBOX_EXEC_PATH);
}

export function buildBashEnvironment(baseEnv = process.env) {
  const env = {};

  for (const key of BASH_ENV_ALLOWLIST) {
    if (typeof baseEnv[key] === 'string' && baseEnv[key] !== '') {
      env[key] = baseEnv[key];
    }
  }

  return {
    ...env,
    FORCE_COLOR: '1',
    PYTHONUNBUFFERED: '1',
    PIP_PROGRESS_BAR: 'on',
    TERM: 'xterm-256color',
  };
}

export function formatBashSandboxNotice(invocation = {}) {
  if (!invocation.redactionOnly) return '';

  const reason = invocation.reason || 'process-level sandbox unavailable';
  return `[SECURITY NOTICE] Process-level bash sandbox is not active (${reason}). Sensitive-file command preflight and output redaction remain active.\n`;
}

export function buildBashSpawnInvocation(command, options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const platform = options.platform || process.platform;
  const sandboxExecPath = options.sandboxExecPath || DEFAULT_SANDBOX_EXEC_PATH;
  const sandboxAvailable = typeof options.sandboxAvailable === 'boolean'
    ? options.sandboxAvailable
    : platform === 'darwin' && existsSync(sandboxExecPath);
  const disableSandbox = typeof options.disableSandbox === 'boolean'
    ? options.disableSandbox
    : process.env.LLM_SPACE_DISABLE_BASH_SANDBOX === '1';
  const sandboxProfile = buildBashSandboxProfile(rootDir);

  if (sandboxProfile && platform === 'darwin' && sandboxAvailable && !disableSandbox) {
    return {
      command: sandboxExecPath,
      args: ['-p', sandboxProfile, 'bash', '-c', command],
      sandboxed: true,
      redactionOnly: false,
      reason: 'process-level sandbox-exec active',
    };
  }

  const reason = !sandboxProfile
    ? 'no sensitive workspace paths detected'
    : disableSandbox
      ? 'process-level sandbox disabled by configuration'
      : platform !== 'darwin'
        ? `process-level sandbox unavailable on ${platform}`
        : 'process-level sandbox-exec unavailable';

  return {
    command: 'bash',
    args: ['-c', command],
    sandboxed: false,
    redactionOnly: !!sandboxProfile,
    reason,
  };
}

export function createSensitiveOutputRedactor(rootDir = process.cwd()) {
  const sensitiveTokens = [];

  for (const filePath of listSensitiveWorkspacePaths(rootDir)) {
    try {
      const stat = statSync(filePath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_REDACTION_FILE_BYTES) continue;

      const content = readFileSync(filePath, 'utf8');
      if (content.trim().length >= 8) {
        sensitiveTokens.push(content.trim());
      }

      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.length >= 8) {
          sensitiveTokens.push(trimmed);
        }
      }
    } catch {
      // Best-effort redaction only; process-level sandbox remains the primary guard.
    }
  }

  const uniqueTokens = [...new Set(sensitiveTokens)].sort((a, b) => b.length - a.length);

  return function redactSensitiveOutput(output) {
    let redacted = String(output || '');
    for (const token of uniqueTokens) {
      redacted = redacted.split(token).join('[REDACTED SENSITIVE FILE CONTENT]');
    }
    return redacted;
  };
}
