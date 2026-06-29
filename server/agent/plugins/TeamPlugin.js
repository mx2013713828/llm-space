import { setTimeout as delay } from 'node:timers/promises';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createTeamBus } from '../teams/teamBus.js';
import { createTeamStateStore } from '../teams/teamStateStore.js';
import { createTeamId, createTeammateId, validateAgentName } from '../teams/teamEnvelope.js';
import { runTeammate } from '../teams/teammateRunner.js';
import { emitTeamUpdate, summarizeTeamState } from '../teams/teamUpdates.js';

const TEAM_TOOLS = new Set(['spawn_teammate', 'send_team_message', 'wait_for_teammates', 'check_team_inbox']);
const DEFAULT_WAIT_TIMEOUT_MS = 15000;
const MAX_WAIT_TIMEOUT_MS = 30000;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 500;
const TERMINAL_TEAMMATE_STATES = new Set(['completed', 'failed', 'no_result', 'cancelled']);
const TEAM_OUTPUT_INLINE_LIMIT = 4000;
const TEAM_MESSAGE_PREVIEW_LIMIT = 800;
const defaultTeamBus = createTeamBus();
const defaultTeamStateStore = createTeamStateStore();
const defaultTeamOutputRootDir = path.join(globalThis.process?.cwd?.() || '.', 'server', 'sessions');

function getInboxText(payload) {
  if (payload?.message) return payload.message;
  if (payload?.content) return payload.content;
  if (payload?.error) {
    const status = payload.status ? ` status=${payload.status}` : '';
    const traceHint = payload.status === 'no_result'
      ? ' Use the teammate trace for details if needed.'
      : '';
    return `ERROR${status}: ${payload.error}${traceHint}`;
  }
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

function truncateText(text, limit = TEAM_MESSAGE_PREVIEW_LIMIT) {
  const value = String(text ?? '');
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n...[truncated ${value.length - limit} chars]`;
}

function formatInboxEntriesPreview(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'No team messages.';
  }

  return messages.map(message => {
    const text = truncateText(getInboxText(message.payload));
    return `- from=${message.from} type=${message.type}${text ? ` text=${text}` : ''}`;
  }).join('\n');
}

async function offloadTeamOutput({ rootDir, harnessId, teamId, label, content }) {
  const dirName = `${harnessId}_team_outputs`;
  const fileName = `${teamId}-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.txt`;
  const dirPath = path.join(rootDir, dirName);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(path.join(dirPath, fileName), content, 'utf-8');
  return `server/sessions/${dirName}/${fileName}`;
}

async function boundTeamOutput({ rootDir, harnessId, teamId, label, fullOutput, previewOutput }) {
  if (fullOutput.length <= TEAM_OUTPUT_INLINE_LIMIT) {
    return fullOutput;
  }

  const offloadPath = await offloadTeamOutput({ rootDir, harnessId, teamId, label, content: fullOutput });
  return `${previewOutput}\n\nFull team inbox offloaded: ${offloadPath}\nUse read_file to inspect the complete teammate report if needed.`;
}

function formatTeamStatus(state) {
  if (!state) return '';

  const summary = summarizeTeamState(state);
  if (!summary.teammates.length) return '';

  const statusLines = summary.teammates.map(teammate => {
    const issue = teammate.error ? ` (${teammate.error})` : '';
    return `- ${teammate.name || teammate.agentId}: ${teammate.state}${issue}`;
  });
  const unresolved = summary.teammates.filter(teammate =>
    ['running', 'awaiting_permission', 'no_result', 'failed', 'cancelled'].includes(teammate.state)
  );
  const reminder = unresolved.length > 0
    ? '\nDo not give a final answer as if all teammates completed; explicitly account for unresolved teammate states.'
    : '';

  return `\n\nTeam status:\n${statusLines.join('\n')}${reminder}`;
}

function getUnresolvedTeammates(state) {
  const teammates = Object.values(state?.teammates ?? {});
  return teammates.filter(teammate => !TERMINAL_TEAMMATE_STATES.has(teammate.state));
}

function sanitizeWaitTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WAIT_TIMEOUT_MS;
  }

  return Math.min(MAX_WAIT_TIMEOUT_MS, Math.floor(parsed));
}

function sanitizeWaitPollIntervalMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WAIT_POLL_INTERVAL_MS;
  }

  return Math.min(2000, Math.max(50, Math.floor(parsed)));
}

async function waitForTeamState({ stateStore, harnessId, teamId, timeoutMs, pollIntervalMs }) {
  const deadline = Date.now() + timeoutMs;
  let state = await stateStore.loadState({ harnessId, teamId });

  while (state && getUnresolvedTeammates(state).length > 0 && Date.now() < deadline) {
    await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    state = await stateStore.loadState({ harnessId, teamId });
  }

  return state;
}

async function buildWaitForTeammatesOutput({ bus, stateStore, harnessId, teamId, timeoutMs, pollIntervalMs }) {
  const state = await waitForTeamState({ stateStore, harnessId, teamId, timeoutMs, pollIntervalMs });

  if (!state) {
    return `No team state found for ${teamId}.`;
  }

  const unreadMessages = await bus.peekInbox({
    harnessId,
    teamId,
    agentId: 'lead',
  });
  const unresolved = getUnresolvedTeammates(state);
  const heading = unresolved.length === 0
    ? 'All teammates reached terminal states.'
    : `Timed out waiting for teammates; ${unresolved.length} teammate(s) still unresolved.`;

  const status = formatTeamStatus(state);
  const inboxHint = `\n\nUnread lead inbox messages: ${unreadMessages.length}`;
  const nextStep = unreadMessages.length > 0
    ? '\nCall check_team_inbox to read teammate results before making final decisions.'
    : '';
  return `${heading}${status}${inboxHint}${nextStep}`;
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

function hasInjectedTeamBlock(apiMessages, tagName) {
  const openTag = `<${tagName}>`;
  return apiMessages.some(message => {
    if (!Array.isArray(message?.content)) return false;
    return message.content.some(entry => entry?.type === 'text' && String(entry.text || '').includes(openTag));
  });
}

function isAsyncTeamsLead(executor) {
  return executor?.runtimeRole !== 'teammate' && executor?.selectedStrategyId === 'async_teams';
}

function buildTeamProtocolGuard({ teamId, unreadCount }) {
  return `<team_protocol_guard>
Team inbox has ${unreadCount} unread message(s) for team ${teamId}.
Before producing the final answer, you must call check_team_inbox to read teammate results.
Do not summarize teammate findings from implicit context alone.
</team_protocol_guard>`;
}

function emitAutoInjectedEvent({ executor, teamId, agentId, inboxMessages }) {
  executor?.onEvent?.('team_inbox_auto_injected', {
    teamId,
    agentId,
    runtimeRole: executor.runtimeRole || 'lead',
    source: 'preLLM',
    messageCount: inboxMessages.length,
    preview: formatInboxEntriesPreview(inboxMessages),
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

function normalizeBriefText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function buildStructuredBrief(args) {
  const brief = {
    objective: normalizeBriefText(args.objective),
    constraints: normalizeBriefText(args.constraints),
    expectedOutput: normalizeBriefText(args.expected_output ?? args.expectedOutput),
    successCriteria: normalizeBriefText(args.success_criteria ?? args.successCriteria),
  };
  const hasStructuredBrief = Object.values(brief).some(Boolean);
  const prompt = normalizeBriefText(args.prompt);

  if (!hasStructuredBrief) {
    if (!prompt) {
      throw new Error('spawn_teammate requires a prompt or objective.');
    }
    return {
      prompt,
      brief: null,
    };
  }

  if (!brief.objective) {
    throw new Error('spawn_teammate structured brief requires objective.');
  }

  const lines = [
    '<teammate_brief>',
    `Objective:\n${brief.objective}`,
    brief.constraints ? `Constraints:\n${brief.constraints}` : '',
    brief.expectedOutput ? `Expected output:\n${brief.expectedOutput}` : '',
    brief.successCriteria ? `Success criteria:\n${brief.successCriteria}` : '',
    prompt ? `Additional context:\n${prompt}` : '',
    '</teammate_brief>',
  ].filter(Boolean);

  return {
    prompt: lines.join('\n\n'),
    brief,
  };
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

export function createTeamPlugin({
  bus = defaultTeamBus,
  stateStore = defaultTeamStateStore,
  runTeammateFn = runTeammate,
  outputRootDir = defaultTeamOutputRootDir,
} = {}) {
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

      if (isAsyncTeamsLead(executor)) {
        const inboxMessages = await bus.peekInbox({
          harnessId,
          teamId,
          agentId,
        });

        if (inboxMessages.length === 0) return;
        if (hasInjectedTeamBlock(apiMessages, 'team_protocol_guard')) return;

        injectInboxBlock(
          apiMessages,
          buildTeamProtocolGuard({ teamId, unreadCount: inboxMessages.length }),
        );
        return;
      }

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
      emitAutoInjectedEvent({ executor, teamId, agentId, inboxMessages });
    },

    async preToolUse(context) {
      const { executor, tool } = context;
      if (!tool || !TEAM_TOOLS.has(tool.toolName)) return;

      try {
        const args = tool.toolInput || {};

        if (tool.toolName === 'spawn_teammate') {
          validateAgentName(args.name);
          const teammateBrief = buildStructuredBrief(args);

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
              prompt: teammateBrief.prompt,
              brief: teammateBrief.brief ?? undefined,
              startedAt: new Date().toISOString(),
            },
          });
          await emitTeamUpdate({
            executor,
            stateStore,
            harnessId,
            teamId,
            fallbackTeammate: {
              agentId: teammateId,
              name: args.name,
              role: args.role ?? null,
              state: 'running',
              prompt: teammateBrief.prompt,
              brief: teammateBrief.brief ?? undefined,
            },
          });

          Promise.resolve(runTeammateFn({
            parentExecutor: executor,
            teamId,
            teammateId,
            name: args.name,
            role: args.role ?? null,
            initialPrompt: teammateBrief.prompt,
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
        } else if (tool.toolName === 'wait_for_teammates') {
          const teamId = resolveTeamId(executor, args.teamId);
          const harnessId = resolveTeamHarnessId(executor);
          tool.toolOutput = await buildWaitForTeammatesOutput({
            bus,
            stateStore,
            harnessId,
            teamId,
            timeoutMs: sanitizeWaitTimeoutMs(args.timeoutMs),
            pollIntervalMs: sanitizeWaitPollIntervalMs(args.pollIntervalMs),
          });
        } else if (tool.toolName === 'check_team_inbox') {
          const teamId = resolveTeamId(executor, args.teamId);
          const harnessId = resolveTeamHarnessId(executor);
          const messages = await bus.readInbox({
            harnessId,
            teamId,
            agentId: 'lead',
          });

          const state = typeof stateStore.loadState === 'function'
            ? await stateStore.loadState({ harnessId, teamId })
            : null;
          const status = formatTeamStatus(state);
          const fullOutput = `${formatInboxEntries(messages)}${status}`;
          const previewOutput = `${formatInboxEntriesPreview(messages)}${status}`;
          tool.toolOutput = await boundTeamOutput({
            rootDir: outputRootDir,
            harnessId,
            teamId,
            label: 'inbox',
            fullOutput,
            previewOutput,
          });
        }
      } catch (error) {
        tool.toolOutput = `[TeamPlugin error]\n${error.message}`;
      }

      tool.handled = true;
    },
  };
}

export const TeamPlugin = createTeamPlugin();
