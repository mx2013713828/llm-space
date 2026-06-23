import {
  TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES,
  getToolName,
} from '../../../src/lib/taskOrchestration.js';

export const EMPTY_TEAMMATE_RESULT = '(teammate finished without a final text result)';

export function createTeammateFeatures(parentFeatures) {
  const childFeatures = structuredClone(parentFeatures ?? {});

  childFeatures.task_orchestration = {
    ...(childFeatures.task_orchestration ?? {}),
    enabled: true,
    mode: 'todo',
    enable_background_tasks: false,
    enable_sub_agents: false,
    enable_agent_teams: true,
    enable_cron_scheduler: false,
  };
  childFeatures.enable_memory = {
    ...(childFeatures.enable_memory ?? {}),
    enabled: false,
  };

  return childFeatures;
}

export function selectTeammateTools(parentTools) {
  const tools = Array.isArray(parentTools) ? parentTools : [];
  const atomicParentTools = tools.filter(tool => {
    const name = getToolName(tool);
    return name !== 'send_team_message' && !TASK_ORCHESTRATION_HIDDEN_TOOL_NAMES.includes(name);
  });

  return [...atomicParentTools, 'send_team_message'];
}

export function createTeammateSystemPrompt({ name, role }) {
  return [
    `You are teammate ${name}.`,
    role ? `Role: ${role}` : '',
    'You are an asynchronous teammate helping the Lead agent.',
    'Do not spawn agents, create scheduled jobs, or manage the Lead task board.',
    'Send important progress or final results to the Lead with send_team_message.',
    'When done, return a concise final answer.',
  ].filter(Boolean).join('\n');
}
