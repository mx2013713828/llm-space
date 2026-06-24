import path from 'path';
import { promises as fs } from 'fs';

function assertSafeId(value, label) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(value || ''))) {
    throw new Error(`Invalid ${label}`);
  }
}

export function getSubAgentTraceDir(harnessId) {
  assertSafeId(harnessId, 'harnessId');
  return path.join(process.cwd(), 'server', 'sessions', `${harnessId}_subagents`);
}

export function summarizeSubAgentMessages(messages = []) {
  const entries = Array.isArray(messages) ? messages : [];
  const toolCalls = entries.filter(entry => entry?.type === 'tool_call');
  const thinkingChars = entries
    .filter(entry => entry?.type === 'thinking')
    .reduce((sum, entry) => sum + String(entry.content || '').length, 0);
  const textChars = entries
    .filter(entry => entry?.type === 'text')
    .reduce((sum, entry) => sum + String(entry.content || '').length, 0);

  return {
    messageCount: entries.length,
    toolCallCount: toolCalls.length,
    thinkingChars,
    textChars,
    toolNames: [...new Set(toolCalls.map(entry => entry.toolName).filter(Boolean))],
  };
}

export async function saveSubAgentTrace({
  harnessId,
  parentToolCallId,
  prompt,
  messages,
  finalAnswer,
  startedAt,
  completedAt,
  status = 'completed',
}) {
  assertSafeId(harnessId, 'harnessId');
  assertSafeId(parentToolCallId, 'parentToolCallId');

  const dir = getSubAgentTraceDir(harnessId);
  await fs.mkdir(dir, { recursive: true });
  const traceId = parentToolCallId;
  const relativePath = `server/sessions/${harnessId}_subagents/${traceId}.json`;
  const trace = {
    schema: 'llm-space.sub_agent_trace.v1',
    traceId,
    parentToolCallId,
    harnessId,
    status,
    prompt,
    finalAnswer,
    startedAt,
    completedAt,
    summary: summarizeSubAgentMessages(messages),
    messages: Array.isArray(messages) ? messages : [],
  };

  await fs.writeFile(path.join(dir, `${traceId}.json`), JSON.stringify(trace, null, 2), 'utf-8');

  return {
    traceId,
    path: relativePath,
    summary: trace.summary,
  };
}

export async function loadSubAgentTrace(harnessId, traceId) {
  assertSafeId(harnessId, 'harnessId');
  assertSafeId(traceId, 'traceId');

  const filePath = path.join(getSubAgentTraceDir(harnessId), `${traceId}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}
