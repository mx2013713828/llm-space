import test from 'node:test';
import assert from 'node:assert/strict';

import { getChildTraceRequest } from './childTraceReference.js';

test('normalizes a sub-agent trace reference', () => {
  assert.deepEqual(getChildTraceRequest({
    childType: 'sub_agent',
    traceRef: {
      traceId: 'tool_1',
      path: 'server/sessions/harness_1_subagents/tool_1.json',
      summary: { messageCount: 3, toolCallCount: 1 },
    },
  }), {
    childType: 'sub_agent',
    title: 'Full Sub-agent Trace',
    collapsedLabel: 'Load full trace',
    expandedLabel: 'Hide full trace',
    url: 'http://localhost:3001/api/sub-agent-traces/harness_1/tool_1',
    summary: { messageCount: 3, toolCallCount: 1 },
  });
});

test('normalizes a teammate trace reference', () => {
  assert.deepEqual(getChildTraceRequest({
    childType: 'teammate',
    traceRef: {
      traceId: 'team_1_reviewer',
      path: 'server/sessions/harness_1_teammates/team_1/team_1_reviewer.json',
      summary: { messageCount: 8, toolCallCount: 4 },
    },
  }), {
    childType: 'teammate',
    title: 'Teammate Trace',
    collapsedLabel: 'Load teammate trace',
    expandedLabel: 'Hide teammate trace',
    url: 'http://localhost:3001/api/team-traces/harness_1/team_1/team_1_reviewer',
    summary: { messageCount: 8, toolCallCount: 4 },
  });
});

test('returns null for missing or unreadable trace references', () => {
  assert.equal(getChildTraceRequest({ childType: 'sub_agent', traceRef: null }), null);
  assert.equal(getChildTraceRequest({ childType: 'sub_agent', traceRef: { path: 'bad/path.json' } }), null);
  assert.equal(getChildTraceRequest({ childType: 'teammate', traceRef: { path: 'server/sessions/h_teammates/team.json' } }), null);
});
