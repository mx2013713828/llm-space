import { parseFeatures } from './FeatureParser.js';
import { resolveSelectedStrategyId as defaultResolveSelectedStrategyId } from './strategies/strategyRegistry.js';
import { resolveRunTeamContext as defaultResolveRunTeamContext } from '../sessions/sessionState.js';

const HARNESS_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function createRuntimeRequestError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.expose = true;
  return err;
}

export function getRuntimeHarnessId(body = {}) {
  const harnessId = String(body.harnessId || '').trim();
  if (!harnessId) {
    throw createRuntimeRequestError(400, '缺少 harnessId');
  }
  if (!HARNESS_ID_PATTERN.test(harnessId)) {
    throw createRuntimeRequestError(400, '非法的 Harness ID');
  }
  return harnessId;
}

function asArray(value, fallback = []) {
  return Array.isArray(value) ? value : fallback;
}

function firstDefined(...values) {
  return values.find(value => value !== undefined);
}

function clonePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return { ...value };
}

function getModelLookupRef(body = {}, harness = {}) {
  return firstDefined(
    body.selectedModelId,
    body.modelRef,
    body.modelId,
    harness.selectedModelId,
    harness.model?.selectedModelId,
    harness.model?.modelRef,
    harness.model?.modelId,
    harness.model?.id,
  );
}

function matchesModelRef(model, modelRef) {
  if (!model || modelRef === undefined || modelRef === null || modelRef === '') return false;
  const ref = String(modelRef);
  return [model.id, model.modelId, model.name].some(value => String(value ?? '') === ref);
}

export function resolveRuntimeModel({ body = {}, harness = {}, models = [] } = {}) {
  if (body.model && typeof body.model === 'object' && !Array.isArray(body.model)) {
    return clonePlainObject(body.model);
  }

  const modelRef = getModelLookupRef(body, harness);
  const selectedModel = Array.isArray(models)
    ? models.find(model => matchesModelRef(model, modelRef))
    : null;

  if (selectedModel) {
    return clonePlainObject(selectedModel);
  }

  if (harness.model && typeof harness.model === 'object' && !Array.isArray(harness.model)) {
    return clonePlainObject(harness.model);
  }

  return {};
}

export function resolveRuntimeFeatures({ body = {}, harness = {} } = {}) {
  return parseFeatures(firstDefined(body.features, harness.features, {}));
}

export function resolveRuntimeStrategy({
  explicitStrategyId,
  features,
  resolveSelectedStrategyId = defaultResolveSelectedStrategyId,
} = {}) {
  const selected = resolveSelectedStrategyId({ explicitStrategyId, features });
  return String(selected || '').trim() || 'custom';
}

async function resolveRuntimeTeamContext({
  body,
  harnessId,
  sessionsDir,
  persistedSession,
  resolveRunTeamContext = defaultResolveRunTeamContext,
}) {
  if (body.teamContext !== undefined && body.teamContext !== null) {
    return body.teamContext;
  }

  if (persistedSession?.teamContext !== undefined) {
    return persistedSession.teamContext;
  }

  if (!sessionsDir || typeof resolveRunTeamContext !== 'function') {
    return null;
  }

  return resolveRunTeamContext({
    sessionsDir,
    harnessId,
    requestedTeamContext: body.teamContext,
  });
}

export async function buildRuntimeRequest({
  body = {},
  harness = {},
  models = [],
  persistedSession = null,
  sessionsDir,
  resolveRunTeamContext = defaultResolveRunTeamContext,
  resolveSelectedStrategyId = defaultResolveSelectedStrategyId,
} = {}) {
  const harnessId = getRuntimeHarnessId(body);
  const features = resolveRuntimeFeatures({ body, harness });
  const selectedStrategyId = resolveRuntimeStrategy({
    explicitStrategyId: body.selectedStrategyId,
    features,
    resolveSelectedStrategyId,
  });
  const model = resolveRuntimeModel({ body, harness, models });
  const teamContext = await resolveRuntimeTeamContext({
    body,
    harnessId,
    sessionsDir,
    persistedSession,
    resolveRunTeamContext,
  });

  return {
    harnessId,
    teamContext,
    messages: asArray(body.messages, asArray(persistedSession?.messages)),
    todos: asArray(body.todos, asArray(persistedSession?.todos)),
    backgroundTasks: asArray(body.backgroundTasks, asArray(persistedSession?.backgroundTasks)),
    systemPrompt: firstDefined(body.systemPrompt, harness.systemPrompt, ''),
    tools: asArray(body.tools, asArray(harness.tools)),
    features,
    model,
    temperature: firstDefined(body.temperature, harness.model?.temperature, 1),
    maxTokens: firstDefined(body.maxTokens, harness.model?.max_tokens, harness.model?.maxTokens, 8192),
    thinkingEnabled: body.thinkingEnabled === true,
		runMode: body.runMode === 'step_through' ? 'step_through' : 'continuous',
    selectedStrategyId,
    interactionMode: firstDefined(body.interactionMode, null),
    skills: asArray(body.skills, asArray(harness.skills)),
  };
}
