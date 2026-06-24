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
const TEAM_LEAD_TOOLS = ['spawn_teammate', 'check_team_inbox'];
const TEAM_COMMUNICATION_TOOLS = ['send_team_message'];
const TEAM_TOOLS = [...TEAM_LEAD_TOOLS, ...TEAM_COMMUNICATION_TOOLS];

export const EXECUTION_STRATEGY_PRESETS = {
  custom: {},
  inline: {
    mode: 'todo',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
  sequential_subagent: {
    mode: 'task_system',
    enable_background_tasks: false,
    enable_sub_agents: true,
    enable_agent_teams: false,
    enable_cron_scheduler: false,
  },
  async_teams: {
    mode: 'task_system',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: true,
    enable_cron_scheduler: false,
  },
};

export const ORCHESTRATION_MANAGED_TOOL_NAMES = [
  ...TODO_PLANNING_TOOLS,
  ...TASK_SYSTEM_PLANNING_TOOLS,
  ...DELEGATION_TOOLS,
  ...BACKGROUND_TASK_TOOLS,
  ...CRON_TOOLS,
];

export const TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES = [
  ...ORCHESTRATION_MANAGED_TOOL_NAMES,
  ...TEAM_TOOLS,
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

export function applyExecutionStrategyPreset(orchestration, strategyId) {
  const selectedStrategy = Object.hasOwn(EXECUTION_STRATEGY_PRESETS, strategyId)
    ? strategyId
    : 'custom';
  const preset = EXECUTION_STRATEGY_PRESETS[selectedStrategy];

  return {
    ...(orchestration ?? {}),
    enabled: selectedStrategy === 'custom' ? (orchestration?.enabled ?? true) : true,
    strategy: selectedStrategy,
    ...preset,
  };
}

export function getStrategyAfterPrimitiveEdit(orchestration, subKey, nextValue) {
  const currentStrategy = orchestration?.strategy || 'custom';
  if (currentStrategy === 'custom' || subKey === 'strategy') {
    return currentStrategy;
  }

  const preset = EXECUTION_STRATEGY_PRESETS[currentStrategy];
  if (!preset || !Object.hasOwn(preset, subKey)) {
    return currentStrategy;
  }

  return preset[subKey] === nextValue ? currentStrategy : 'custom';
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

export function resolveOrchestrationTools(requestedTools, orchestration, options = {}) {
  const { runtimeRole = 'lead' } = options;
  const requested = Array.isArray(requestedTools) ? requestedTools : [];
  const requestedToolNames = new Set(requested.map(getToolName));
  const cleanedTools = dedupeByName(
    requested.filter(tool => !TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES.includes(getToolName(tool)))
  );

  if (!isOrchestrationEnabled(orchestration)) {
    return cleanedTools;
  }

  if (runtimeRole === 'teammate') {
    const resolved = [...cleanedTools];

    if (requestedToolNames.has('send_team_message')) {
      appendTools(resolved, TEAM_COMMUNICATION_TOOLS);
    }

    return resolved;
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

  if (isOrchestrationEnabled(orchestration, 'enable_agent_teams')) {
    appendTools(resolved, [TEAM_LEAD_TOOLS[0]]);
    appendTools(resolved, TEAM_COMMUNICATION_TOOLS);
    appendTools(resolved, TEAM_LEAD_TOOLS.slice(1));
  }

  return resolved;
}
