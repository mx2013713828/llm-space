import {
  createChildAgentProfile,
  createChildFeatures,
  selectChildTools,
} from '../child/childAgentProfile.js';

export const EMPTY_TEAMMATE_RESULT = '(teammate finished without a final text result)';

export function createTeammateFeatures(parentFeatures) {
  return createChildFeatures(parentFeatures, {
    taskOrchestration: {
      enabled: true,
      mode: 'todo',
      enable_background_tasks: false,
      enable_sub_agents: false,
      enable_agent_teams: true,
      enable_cron_scheduler: false,
    },
    memoryEnabled: false,
  });
}

export function selectTeammateTools(parentTools) {
  return selectChildTools(parentTools, {
    toolFilter: 'hidden_orchestration',
    appendTools: ['send_team_message'],
  });
}

export function createTeammateSystemPrompt({ name, role }) {
  return [
    `You are teammate ${name}.`,
    role ? `Role: ${role}` : '',
    'You are an asynchronous teammate helping the Lead agent.',
    'Do not spawn agents, create scheduled jobs, or manage the Lead task board.',
    'Send important progress or final results to the Lead with send_team_message.',
    'Your final turn must be a plain text report for the Lead, not a tool call.',
    'Do not rely only on send_team_message for your final result; also end with the same report as assistant text.',
    'If you used tools, synthesize their results in that final text report.',
    'When done, return a concise final answer.',
  ].filter(Boolean).join('\n');
}

export function createTeammateProfile({
  parentExecutor,
  teamId,
  teammateId,
  name,
  role,
  initialPrompt,
  cwd,
}) {
  return createChildAgentProfile({
    childType: 'teammate',
    childId: teammateId,
    name,
    role: role ?? null,
    parentHarnessId: parentExecutor.harnessId,
    prompt: initialPrompt,
    systemPrompt: createTeammateSystemPrompt({ name, role }),
    parentTools: parentExecutor.tools,
    parentFeatures: parentExecutor.features,
    featurePolicy: {
      taskOrchestration: {
        enabled: true,
        mode: 'todo',
        enable_background_tasks: false,
        enable_sub_agents: false,
        enable_agent_teams: true,
        enable_cron_scheduler: false,
      },
      memoryEnabled: false,
    },
    toolPolicy: {
      toolFilter: 'hidden_orchestration',
      appendTools: ['send_team_message'],
    },
    extra: {
      cwd,
      runtimeRole: 'teammate',
      teamContext: {
        teamId,
        agentId: teammateId,
        leadId: 'lead',
        harnessId: parentExecutor.harnessId,
      },
    },
  });
}
