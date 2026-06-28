import path from 'node:path';
import process from 'node:process';
import { promises as fs } from 'node:fs';

import { summarizeSubAgentMessages } from '../subagents/subAgentTraceStore.js';

function assertSafeId(value, label) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(value || ''))) {
    throw new Error(`Invalid ${label}`);
  }
}

export function getTeammateTraceDir(harnessId, teamId) {
  assertSafeId(harnessId, 'harnessId');
  assertSafeId(teamId, 'teamId');
  return path.join(process.cwd(), 'server', 'sessions', `${harnessId}_teammates`, teamId);
}

export async function saveTeammateTrace({
  harnessId,
  teamId,
  teammateId,
  name,
  role,
  prompt,
  brief,
  messages,
  finalAnswer,
  startedAt,
  completedAt,
  status = 'completed',
}) {
  assertSafeId(harnessId, 'harnessId');
  assertSafeId(teamId, 'teamId');
  assertSafeId(teammateId, 'teammateId');

  const dir = getTeammateTraceDir(harnessId, teamId);
  await fs.mkdir(dir, { recursive: true });
  const traceId = `${teamId}_${teammateId}`;
  const relativePath = `server/sessions/${harnessId}_teammates/${teamId}/${teammateId}.json`;
  const trace = {
    schema: 'llm-space.teammate_trace.v1',
    traceId,
    harnessId,
    teamId,
    teammateId,
    name,
    role: role ?? null,
    status,
    prompt,
    brief,
    finalAnswer,
    startedAt,
    completedAt,
    summary: summarizeSubAgentMessages(messages),
    messages: Array.isArray(messages) ? messages : [],
  };

  await fs.writeFile(path.join(dir, `${teammateId}.json`), JSON.stringify(trace, null, 2), 'utf-8');

  return {
    traceId,
    path: relativePath,
    summary: trace.summary,
  };
}

export async function loadTeammateTrace(harnessId, teamId, teammateId) {
  assertSafeId(harnessId, 'harnessId');
  assertSafeId(teamId, 'teamId');
  assertSafeId(teammateId, 'teammateId');

  const filePath = path.join(getTeammateTraceDir(harnessId, teamId), `${teammateId}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
