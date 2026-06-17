export const DEFAULT_CONTEXT_WINDOW = 128000;

export function parseContextWindow(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

export function getModelContextWindow(model = {}) {
  const safeModel = model && typeof model === 'object' ? model : {};
  const explicit = parseContextWindow(safeModel.contextWindow ?? safeModel.context_window);
  if (explicit) {
    return { value: explicit, estimated: false };
  }
  return { value: DEFAULT_CONTEXT_WINDOW, estimated: true };
}

export function formatTokenCount(value) {
  const tokens = Number(value) || 0;
  if (tokens >= 1000000) {
    const millions = tokens / 1000000;
    return `${Number.isInteger(millions) ? millions : Number(millions.toFixed(2))}M`;
  }
  if (tokens >= 1000) {
    const thousands = tokens / 1000;
    return `${Number.isInteger(thousands) ? thousands : Number(thousands.toFixed(1))}k`;
  }
  return String(Math.round(tokens));
}
