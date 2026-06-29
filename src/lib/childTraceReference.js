const API_BASE = 'http://localhost:3001';

const TRACE_PRESENTATION = {
  sub_agent: {
    title: 'Full Sub-agent Trace',
    collapsedLabel: 'Load full trace',
    expandedLabel: 'Hide full trace',
  },
  teammate: {
    title: 'Teammate Trace',
    collapsedLabel: 'Load teammate trace',
    expandedLabel: 'Hide teammate trace',
  },
};

function getSubAgentTraceUrl(path) {
  const match = String(path || '').match(/^server\/sessions\/([^/]+)_subagents\/([^/]+)\.json$/);
  if (!match) return null;
  return `${API_BASE}/api/sub-agent-traces/${match[1]}/${match[2]}`;
}

function getTeammateTraceUrl(path) {
  const match = String(path || '').match(/^server\/sessions\/([^/]+)_teammates\/([^/]+)\/([^/]+)\.json$/);
  if (!match) return null;
  return `${API_BASE}/api/team-traces/${match[1]}/${match[2]}/${match[3]}`;
}

export function getChildTraceRequest({ childType, traceRef } = {}) {
  if (!traceRef?.path) return null;

  const presentation = TRACE_PRESENTATION[childType];
  if (!presentation) return null;

  const url = childType === 'sub_agent'
    ? getSubAgentTraceUrl(traceRef.path)
    : getTeammateTraceUrl(traceRef.path);
  if (!url) return null;

  return {
    childType,
    title: presentation.title,
    collapsedLabel: presentation.collapsedLabel,
    expandedLabel: presentation.expandedLabel,
    url,
    summary: traceRef.summary,
  };
}
