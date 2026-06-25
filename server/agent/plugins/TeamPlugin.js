import { createTeamBus } from '../teams/teamBus.js';
import { createTeamStateStore } from '../teams/teamStateStore.js';
import { createTeamId, createTeammateId, validateAgentName } from '../teams/teamEnvelope.js';
import { runTeammate } from '../teams/teammateRunner.js';

const TEAM_TOOLS = new Set(['spawn_teammate', 'send_team_message', 'check_team_inbox']);
const DEFAULT_TEAMMATE_MAX_TURNS = 6;
const MAX_TEAMMATE_MAX_TURNS = 12;
const defaultTeamBus = createTeamBus();
const defaultTeamStateStore = createTeamStateStore();

function getInboxText(payload) {
  if (payload?.message) return payload.message;
  if (payload?.content) return payload.content;
  if (payload?.error) return `ERROR: ${payload.error}`;
  if (payload == null) return '';
  return JSON.stringify(payload);
}

function formatInboxEntries(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'No team messages.';
  }

  return messages.map(message => {
    const text = getInboxText(message.payload);
    return `- from=${message.from} type=${message.type}${text ? ` text=${text}` : ''}`;
  }).join('\n');
}

function injectInboxBlock(apiMessages, block) {
  const lastApiMsg = apiMessages[apiMessages.length - 1];
  const hasToolResult = lastApiMsg
    && lastApiMsg.role === 'user'
    && Array.isArray(lastApiMsg.content)
    && lastApiMsg.content.some(entry => entry.type === 'tool_result');

  if (lastApiMsg && lastApiMsg.role === 'user' && !hasToolResult && Array.isArray(lastApiMsg.content)) {
    const textBlock = lastApiMsg.content.find(entry => entry.type === 'text');
    if (textBlock) {
      textBlock.text = `${block}\n\n${textBlock.text}`;
      return;
    }
  }

  apiMessages.push({
    role: 'user',
    content: [{ type: 'text', text: block }],
  });
}

function resolveInboxAgentId(executor) {
  if (executor.runtimeRole === 'teammate') {
    return executor.teamContext?.agentId;
  }
  return executor.teamContext?.leadId ?? 'lead';
}

function resolveTeamHarnessId(executor) {
  return executor.teamContext?.harnessId || executor.harnessId;
}

function sanitizeMaxTurns(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TEAMMATE_MAX_TURNS;
  }

  return Math.min(MAX_TEAMMATE_MAX_TURNS, Math.floor(parsed));
}

async function ensureTeam({ executor, stateStore }) {
  if (executor._teamEnsurePromise) {
    return executor._teamEnsurePromise;
  }

  if (executor.teamContext?.teamId && executor.teamContext?.harnessId) {
    return executor.teamContext.teamId;
  }

  executor._teamEnsurePromise = ensureTeamState({ executor, stateStore }).catch(error => {
    executor._teamEnsurePromise = null;
    throw error;
  });

  return executor._teamEnsurePromise;
}

async function ensureTeamState({ executor, stateStore }) {
  const currentTeamId = executor.teamContext?.teamId;
  const teamId = currentTeamId || createTeamId();
  const harnessId = resolveTeamHarnessId(executor);
  const existingState = await stateStore.loadState({
    harnessId,
    teamId,
  });

  if (!existingState) {
    await stateStore.createTeam({ harnessId, teamId });
  }

  if (!executor.teamContext) {
    executor.teamContext = { teamId, agentId: 'lead', leadId: 'lead', harnessId };
  } else if (!executor.teamContext.teamId) {
    executor.teamContext = { ...executor.teamContext, teamId, harnessId };
  } else if (!executor.teamContext.harnessId) {
    executor.teamContext = { ...executor.teamContext, harnessId };
  }

  return teamId;
}

function resolveTeamId(executor, requestedTeamId) {
  const teamId = requestedTeamId || executor.teamContext?.teamId;
  if (!teamId) {
    throw new Error('Missing teamId. Spawn a teammate first or pass teamId explicitly.');
  }
  return teamId;
}

export function createTeamPlugin({ bus = defaultTeamBus, stateStore = defaultTeamStateStore, runTeammateFn = runTeammate } = {}) {
  return {
    name: 'TeamPlugin',

    async preLLM(context) {
      const { executor, apiMessages } = context;
      if (!executor) return;

      const teamId = executor.teamContext?.teamId;
      if (!teamId) return;
      const agentId = resolveInboxAgentId(executor);
      if (!agentId) return;
      const harnessId = resolveTeamHarnessId(executor);

      const inboxMessages = await bus.readInbox({
        harnessId,
        teamId,
        agentId,
      });

      if (inboxMessages.length === 0) return;

      injectInboxBlock(
        apiMessages,
        `<team_inbox>\n${formatInboxEntries(inboxMessages)}\n</team_inbox>`,
      );
    },

    async preToolUse(context) {
      const { executor, tool } = context;
      if (!tool || !TEAM_TOOLS.has(tool.toolName)) return;

      try {
        const args = tool.toolInput || {};

        if (tool.toolName === 'spawn_teammate') {
          validateAgentName(args.name);
          if (typeof args.prompt !== 'string' || !args.prompt.trim()) {
            throw new Error('spawn_teammate requires a prompt.');
          }

          const teamId = await ensureTeam({ executor, stateStore });
          const teammateId = createTeammateId(args.name);
          const harnessId = resolveTeamHarnessId(executor);

          await stateStore.upsertTeammate({
            harnessId,
            teamId,
            teammate: {
              agentId: teammateId,
              name: args.name,
              role: args.role ?? null,
              state: 'running',
            },
          });

          Promise.resolve(runTeammateFn({
            parentExecutor: executor,
            teamId,
            teammateId,
            name: args.name,
            role: args.role ?? null,
            initialPrompt: args.prompt,
            maxTurns: sanitizeMaxTurns(args.maxTurns),
          })).catch(error => {
            console.error('[TeamPlugin] Teammate runner failed:', error);
          });

          tool.toolOutput = JSON.stringify({ teamId, teammateId, status: 'running' });
        } else if (tool.toolName === 'send_team_message') {
          if (typeof args.to !== 'string' || !args.to.trim()) {
            throw new Error('send_team_message requires "to".');
          }
          if (typeof args.message !== 'string' || !args.message.trim()) {
            throw new Error('send_team_message requires "message".');
          }

          const teamId = resolveTeamId(executor, args.teamId);
          const envelope = await bus.sendMessage({
            harnessId: resolveTeamHarnessId(executor),
            teamId,
            from: executor.teamContext?.agentId ?? 'lead',
            to: args.to,
            type: 'message',
            payload: { message: args.message },
          });

          tool.toolOutput = `Sent team message to ${envelope.to}.`;
        } else if (tool.toolName === 'check_team_inbox') {
          const teamId = resolveTeamId(executor, args.teamId);
          const messages = await bus.readInbox({
            harnessId: resolveTeamHarnessId(executor),
            teamId,
            agentId: 'lead',
          });

          tool.toolOutput = formatInboxEntries(messages);
        }
      } catch (error) {
        tool.toolOutput = `[TeamPlugin error]\n${error.message}`;
      }

      tool.handled = true;
    },
  };
}

export const TeamPlugin = createTeamPlugin();
