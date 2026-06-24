import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { isOrchestrationEnabled } from '../../../src/lib/taskOrchestration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_STRATEGIES_DIR = __dirname;

const BUILT_IN_STRATEGY_FILES = [
  'inline.md',
  'sequential-subagent.md',
  'async-teams.md',
  'custom.md',
];

function stripQuotes(value) {
  const trimmed = String(value ?? '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseStrategyFrontmatter(content) {
  const match = String(content ?? '').match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n?/);
  if (!match) {
    return { meta: {}, body: String(content ?? '') };
  }

  const meta = {};
  let currentListKey = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem && currentListKey) {
      meta[currentListKey].push(stripQuotes(listItem[1]));
      continue;
    }

    const keyValue = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValue) continue;

    const key = keyValue[1];
    const value = keyValue[2].trim();
    currentListKey = null;

    if (value === '[]') {
      meta[key] = [];
      continue;
    }

    if (value === '') {
      meta[key] = [];
      currentListKey = key;
      continue;
    }

    meta[key] = stripQuotes(value);
  }

  return {
    meta,
    body: String(content ?? '').slice(match[0].length).trim(),
  };
}

function normalizeStrategyMeta(meta, filename) {
  const id = stripQuotes(meta.id || path.basename(filename, '.md')).replace(/-/g, '_');
  return {
    id,
    name: stripQuotes(meta.name || id),
    description: stripQuotes(meta.description || ''),
    requiredPrimitives: Array.isArray(meta.required_primitives) ? meta.required_primitives : [],
    recommendedPrimitives: Array.isArray(meta.recommended_primitives) ? meta.recommended_primitives : [],
    file: filename,
  };
}

async function readStrategyFile(filename, strategiesDir = DEFAULT_STRATEGIES_DIR) {
  const filePath = path.join(strategiesDir, filename);
  const content = await fs.readFile(filePath, 'utf-8');
  const parsed = parseStrategyFrontmatter(content);
  return {
    ...normalizeStrategyMeta(parsed.meta, filename),
    body: parsed.body,
  };
}

export async function listExecutionStrategies(options = {}) {
  const strategiesDir = options.strategiesDir || DEFAULT_STRATEGIES_DIR;
  const strategies = [];

  for (const filename of BUILT_IN_STRATEGY_FILES) {
    const strategy = await readStrategyFile(filename, strategiesDir);
    const { body, ...meta } = strategy;
    strategies.push(meta);
  }

  return strategies;
}

export async function loadExecutionStrategy(strategyId, options = {}) {
  const normalizedId = String(strategyId || '').trim();
  if (!normalizedId) return null;

  const strategiesDir = options.strategiesDir || DEFAULT_STRATEGIES_DIR;
  for (const filename of BUILT_IN_STRATEGY_FILES) {
    const strategy = await readStrategyFile(filename, strategiesDir);
    if (strategy.id === normalizedId) {
      return strategy;
    }
  }

  throw new Error(`Unknown execution strategy: ${normalizedId}`);
}

export function resolveSelectedStrategyId({ explicitStrategyId, features } = {}) {
  const explicit = String(explicitStrategyId || '').trim();
  if (explicit) return explicit;

  const orchestration = features?.task_orchestration;
  return String(orchestration?.strategy || '').trim();
}

export function getMissingRequiredPrimitives(strategy, features = {}) {
  if (!strategy || strategy.id === 'custom') return [];

  const orchestration = features?.task_orchestration;
  const missing = [];

  for (const primitive of strategy.requiredPrimitives || []) {
    if (primitive === 'task_orchestration' && !isOrchestrationEnabled(orchestration)) {
      missing.push(primitive);
    } else if (primitive === 'sub_agent' && !isOrchestrationEnabled(orchestration, 'enable_sub_agents')) {
      missing.push(primitive);
    } else if (primitive === 'agent_teams' && !isOrchestrationEnabled(orchestration, 'enable_agent_teams')) {
      missing.push(primitive);
    } else if (primitive === 'cron' && !isOrchestrationEnabled(orchestration, 'enable_cron_scheduler')) {
      missing.push(primitive);
    }
  }

  return missing;
}

export function buildStrategyContextBlock(strategy, features = {}) {
  if (!strategy || strategy.id === 'custom') return '';

  const missing = getMissingRequiredPrimitives(strategy, features);
  const compatibility = missing.length > 0
    ? `\n<strategy_compatibility_note>Missing required primitives: ${missing.join(', ')}. Follow the guideline only where supported by mounted tools.</strategy_compatibility_note>`
    : '';

  return `<active_execution_strategy id="${strategy.id}" name="${strategy.name}">
${strategy.body}${compatibility}
</active_execution_strategy>`;
}

export function buildStrategyIndexBlock(strategies = []) {
  const lines = strategies
    .map(strategy => {
      const required = (strategy.requiredPrimitives || []).join(', ') || 'none';
      return `- ${strategy.id}: ${strategy.name} | requires: ${required} | ${strategy.description}`;
    })
    .join('\n');

  return `<available_execution_strategies>
These are high-level orchestration strategies. They guide behavior only; mounted tools and runtime policy remain authoritative.
${lines}
</available_execution_strategies>`;
}
