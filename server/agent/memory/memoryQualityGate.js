const VALID_DECISIONS = ['auto_write', 'pending_review', 'discard', 'sensitive_blocked'];

const SENSITIVE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/i,
  /\btvly-[A-Za-z0-9_-]{8,}/i,
  /\b(api[_ -]?key|secret|token|password|passwd|credential)\b/i,
  /密钥|凭证|令牌|密码/i,
];

const TRANSIENT_PATTERNS = [
  /teammate|checker|reviewer|审查报告|测试报告/i,
  /\bP0\b|\bP1\b|\bP2\b|\bP3\b/i,
  /当前任务|本轮|这次|执行轨迹|运行日志|临时|刚才/i,
  /Insufficient Balance|TimeoutError|tool call|工具调用/i,
];

const AUTO_WRITE_TYPES = new Set(['user', 'feedback']);
const MIN_AUTO_WRITE_CONFIDENCE = 0.8;
const MIN_PENDING_CONFIDENCE = 0.45;

export function classifyMemoryItem(item = {}, context = {}) {
  const text = getMemoryText(item);
  const confidence = normalizeConfidence(item.confidence);

  if (matchesAny(text, SENSITIVE_PATTERNS)) {
    return buildDecision('sensitive_blocked', {
      confidence,
      risk: 'sensitive',
      reason: 'Blocked because the memory appears to contain sensitive credentials or secrets.',
    });
  }

  if (matchesAny(text, TRANSIENT_PATTERNS) || isTransientSource(context.source)) {
    return buildDecision('discard', {
      confidence,
      risk: 'transient',
      reason: 'Discarded because the memory appears to describe transient runtime output rather than durable knowledge.',
    });
  }

  if (context.explicitMemoryRequest && confidence >= MIN_PENDING_CONFIDENCE) {
    return buildDecision('auto_write', {
      confidence: Math.max(confidence, 0.9),
      risk: 'low',
      reason: 'Auto-written because the user explicitly requested durable memory.',
    });
  }

  if (AUTO_WRITE_TYPES.has(item.type) && confidence >= MIN_AUTO_WRITE_CONFIDENCE) {
    return buildDecision('auto_write', {
      confidence,
      risk: 'low',
      reason: 'Auto-written because this is a high-confidence stable user preference or feedback memory.',
    });
  }

  return buildDecision('pending_review', {
    confidence,
    risk: confidence < MIN_PENDING_CONFIDENCE ? 'medium' : 'medium',
    reason: 'Queued for review because the memory may be useful but is not safe enough to auto-write.',
  });
}

export function summarizeMemoryRouting(results = []) {
  const summary = Object.fromEntries(VALID_DECISIONS.map(decision => [decision, 0]));
  for (const result of results || []) {
    if (result?.decision in summary) summary[result.decision] += 1;
  }
  return summary;
}

function buildDecision(decision, { confidence, risk, reason }) {
  return {
    decision,
    confidence,
    risk,
    reason,
  };
}

function getMemoryText(item = {}) {
  return [
    item.name,
    item.type,
    item.description,
    item.body,
    item.reason,
  ].map(value => String(value || '')).join('\n');
}

function normalizeConfidence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0.75;
  return Math.max(0, Math.min(1, parsed));
}

function matchesAny(text, patterns) {
  return patterns.some(pattern => pattern.test(text));
}

function isTransientSource(source = {}) {
  return ['teammate', 'sub_agent', 'scheduled', 'tool', 'background'].includes(source.kind);
}
