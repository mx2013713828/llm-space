import path from 'node:path';
import { promises as fs } from 'node:fs';

export const AGENT_GUIDANCE_FILENAME = 'AGENTS.md';

const HARNESS_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeHarnessId(harnessId) {
  if (!harnessId || typeof harnessId !== 'string' || !HARNESS_ID_PATTERN.test(harnessId)) {
    throw new Error(`Invalid harness ID: ${harnessId || ''}`);
  }
}

function defaultGuidanceRoot() {
  return path.join(process.cwd(), 'guidance');
}

export function getAgentGuidancePath({
  harnessId,
  guidanceRoot = defaultGuidanceRoot(),
} = {}) {
  assertSafeHarnessId(harnessId);
  const absoluteRoot = path.resolve(guidanceRoot);
  const absolutePath = path.join(absoluteRoot, harnessId, AGENT_GUIDANCE_FILENAME);
  const relativePath = path.join('guidance', harnessId, AGENT_GUIDANCE_FILENAME);

  if (!absolutePath.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error('Access denied: guidance path traversal detected');
  }

  return {
    absolutePath,
    file: relativePath.split(path.sep).join('/'),
    filename: AGENT_GUIDANCE_FILENAME,
  };
}

export async function saveAgentGuidance({
  harnessId,
  content = '',
  guidanceRoot = defaultGuidanceRoot(),
  fsImpl = fs,
} = {}) {
  const guidancePath = getAgentGuidancePath({ harnessId, guidanceRoot });
  await fsImpl.mkdir(path.dirname(guidancePath.absolutePath), { recursive: true });
  await fsImpl.writeFile(guidancePath.absolutePath, String(content ?? ''), 'utf-8');
  return {
    ...guidancePath,
    content: String(content ?? ''),
    source: 'file',
  };
}

export async function loadAgentGuidance({
  harnessId,
  fallbackContent = '',
  guidanceRoot = defaultGuidanceRoot(),
  fsImpl = fs,
} = {}) {
  const guidancePath = getAgentGuidancePath({ harnessId, guidanceRoot });

  try {
    const content = await fsImpl.readFile(guidancePath.absolutePath, 'utf-8');
    return {
      ...guidancePath,
      content,
      source: 'file',
    };
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }

  const content = String(fallbackContent ?? '');
  await fsImpl.mkdir(path.dirname(guidancePath.absolutePath), { recursive: true });
  await fsImpl.writeFile(guidancePath.absolutePath, content, 'utf-8');
  return {
    ...guidancePath,
    content,
    source: 'initialized_from_legacy',
  };
}

export function stripLegacySystemPrompt(harness = {}) {
  const { systemPrompt, ...rest } = harness || {};
  return rest;
}
