const TASK_SYSTEM_PLANNING_TOOLS = [
  'create_task',
  'list_tasks',
  'get_task',
  'claim_task',
  'complete_task',
];

const TODO_PLANNING_TOOLS = ['write_todos'];
const DELEGATION_TOOLS = ['sub_agent'];
const BACKGROUND_TASK_TOOLS = ['query_background_tasks'];
const CRON_TOOLS = ['schedule_cron', 'list_crons', 'cancel_cron'];

export const ORCHESTRATION_MANAGED_TOOL_NAMES = [
  ...TODO_PLANNING_TOOLS,
  ...TASK_SYSTEM_PLANNING_TOOLS,
  ...DELEGATION_TOOLS,
  ...BACKGROUND_TASK_TOOLS,
  ...CRON_TOOLS,
];

export function getNextGroupFeatureState(previousValue, groupMeta, enabled) {
  const previousGroup = previousValue && typeof previousValue === 'object'
    ? previousValue
    : {};
  const nextGroup = { enabled };

  for (const [subKey, subMeta] of Object.entries(groupMeta?.children ?? {})) {
    if (groupMeta?.preserveChildrenWhenDisabled) {
      nextGroup[subKey] = previousGroup[subKey] ?? subMeta.defaultValue;
      continue;
    }

    nextGroup[subKey] = enabled
      ? (previousGroup.enabled ? (previousGroup[subKey] ?? subMeta.defaultValue) : subMeta.defaultValue)
      : subMeta.defaultValue;
  }

  return nextGroup;
}

export function getToolName(tool) {
  if (typeof tool === 'string') {
    return tool;
  }

  return tool?.name ?? '';
}

export function isOrchestrationEnabled(orchestration, capability) {
  if (orchestration?.enabled === false) {
    return false;
  }

  if (!capability) {
    return orchestration?.enabled !== false;
  }

  return orchestration?.[capability] === true;
}

function dedupeByName(tools) {
  const seen = new Set();
  const result = [];

  for (const tool of tools) {
    const toolName = getToolName(tool);
    if (!toolName || seen.has(toolName)) {
      continue;
    }

    seen.add(toolName);
    result.push(tool);
  }

  return result;
}

function appendTools(target, tools) {
  for (const tool of tools) {
    if (!target.includes(tool)) {
      target.push(tool);
    }
  }
}

export function resolveOrchestrationTools(requestedTools, orchestration) {
  const requested = Array.isArray(requestedTools) ? requestedTools : [];
  const cleanedTools = dedupeByName(
    requested.filter(tool => !ORCHESTRATION_MANAGED_TOOL_NAMES.includes(getToolName(tool)))
  );

  if (!isOrchestrationEnabled(orchestration)) {
    return cleanedTools;
  }

  const resolved = [...cleanedTools];

  if (orchestration?.mode === 'task_system') {
    appendTools(resolved, TASK_SYSTEM_PLANNING_TOOLS);
  } else {
    appendTools(resolved, TODO_PLANNING_TOOLS);
  }

  if (isOrchestrationEnabled(orchestration, 'enable_sub_agents')) {
    appendTools(resolved, DELEGATION_TOOLS);
  }

  if (isOrchestrationEnabled(orchestration, 'enable_background_tasks')) {
    appendTools(resolved, BACKGROUND_TASK_TOOLS);
  }

  if (isOrchestrationEnabled(orchestration, 'enable_cron_scheduler')) {
    appendTools(resolved, CRON_TOOLS);
  }

  return resolved;
}
