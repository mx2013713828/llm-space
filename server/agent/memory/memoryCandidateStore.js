import path from 'path';
import { promises as fs } from 'fs';

import { getMemoryDir } from './memoryStore.js';

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected']);

export function getMemoryCandidateDir(harnessId) {
  return path.join(getMemoryDir(harnessId), '_candidates');
}

export async function createMemoryCandidate({
  harnessId,
  item,
  source = { kind: 'conversation' },
  reason = '',
  confidence = 0,
  risk = 'medium',
  now = () => new Date(),
} = {}) {
  const dir = getMemoryCandidateDir(harnessId);
  await fs.mkdir(dir, { recursive: true });

  const createdAt = toIsoString(now());
  const id = createCandidateId(createdAt);
  const candidate = {
    schema: 'llm-space.memory_candidate.v1',
    id,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
    item: normalizeItem(item),
    source,
    reason,
    confidence: normalizeConfidence(confidence),
    risk,
  };

  await writeCandidateFile(dir, candidate);
  return candidate;
}

export async function listMemoryCandidates({ harnessId, status } = {}) {
  const dir = getMemoryCandidateDir(harnessId);
  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const candidates = (await Promise.all(
      entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(async entry => {
          try {
            const raw = await fs.readFile(path.join(dir, entry.name), 'utf-8');
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })
    )).filter(Boolean);

    return candidates
      .filter(candidate => !status || candidate.status === status)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch {
    return [];
  }
}

export async function approveMemoryCandidate({
  harnessId,
  candidateId,
  patch = {},
  now = () => new Date(),
} = {}) {
  const candidate = await loadMemoryCandidate({ harnessId, candidateId });
  const updatedAt = toIsoString(now());
  const next = {
    ...candidate,
    status: 'approved',
    updatedAt,
    approvedAt: updatedAt,
    item: normalizeItem({
      ...candidate.item,
      ...patch,
    }),
  };
  await writeCandidateFile(getMemoryCandidateDir(harnessId), next);
  return next;
}

export async function rejectMemoryCandidate({
  harnessId,
  candidateId,
  reason = '',
  now = () => new Date(),
} = {}) {
  const candidate = await loadMemoryCandidate({ harnessId, candidateId });
  const updatedAt = toIsoString(now());
  const next = {
    ...candidate,
    status: 'rejected',
    updatedAt,
    rejectedAt: updatedAt,
    rejectionReason: reason,
  };
  await writeCandidateFile(getMemoryCandidateDir(harnessId), next);
  return next;
}

export async function loadMemoryCandidate({ harnessId, candidateId } = {}) {
  assertSafeCandidateId(candidateId);
  const filePath = path.join(getMemoryCandidateDir(harnessId), `${candidateId}.json`);
  const raw = await fs.readFile(filePath, 'utf-8');
  const candidate = JSON.parse(raw);
  if (!VALID_STATUSES.has(candidate.status)) {
    throw new Error(`Invalid memory candidate status: ${candidate.status}`);
  }
  return candidate;
}

function createCandidateId(createdAt) {
  const timestamp = createdAt.replace(/[^0-9]/g, '').slice(0, 14);
  const suffix = Math.random().toString(16).slice(2, 10);
  return `memcand_${timestamp}_${suffix}`;
}

function normalizeItem(item = {}) {
  return {
    name: String(item.name || '').trim(),
    type: String(item.type || 'user').trim() || 'user',
    description: String(item.description || '').replace(/[\r\n]/g, ' ').trim(),
    body: String(item.body || '').trim(),
  };
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function assertSafeCandidateId(candidateId) {
  if (!/^memcand_[A-Za-z0-9_-]+$/.test(String(candidateId || ''))) {
    throw new Error(`Invalid candidateId: ${candidateId}`);
  }
}

async function writeCandidateFile(dir, candidate) {
  assertSafeCandidateId(candidate.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${candidate.id}.json`), JSON.stringify(candidate, null, 2), 'utf-8');
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}
