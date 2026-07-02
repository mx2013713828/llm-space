import { createModelRegistry } from './model/modelRegistry.js';

function findModelsConfigRange(envText) {
  const lines = String(envText || '').split('\n');
  const start = lines.findIndex(line => line.trimStart().startsWith('MODELS_CONFIG='));
  if (start === -1) return null;

  let rawValue = lines[start].slice(lines[start].indexOf('=') + 1);
  for (let end = start; end < lines.length; end++) {
    if (end > start) rawValue += `\n${lines[end]}`;
    try {
      JSON.parse(rawValue);
      return { start, end, rawValue };
    } catch {
      // Keep consuming lines until the JSON array/object becomes complete.
    }
  }

  return { start, end: start, rawValue: lines[start].slice(lines[start].indexOf('=') + 1) };
}

export function parseModelsConfig(envText) {
  const range = findModelsConfigRange(envText);
  if (!range) return [];
  const parsed = JSON.parse(range.rawValue);
  return Array.isArray(parsed) ? parsed : [];
}

export function parseModelRegistry(envText) {
  return createModelRegistry(parseModelsConfig(envText));
}

export function formatModelsConfig(models) {
  return `MODELS_CONFIG=${JSON.stringify(models || [], null, 2)}`;
}

export function upsertModelsConfig(envText, models) {
  const text = String(envText || '');
  const lines = text.split('\n');
  const formatted = formatModelsConfig(models);
  const range = findModelsConfigRange(text);

  if (!range) {
    const prefix = text && !text.endsWith('\n') ? `${text}\n` : text;
    return `${prefix}${formatted}\n`;
  }

  lines.splice(range.start, range.end - range.start + 1, ...formatted.split('\n'));
  return lines.join('\n');
}
