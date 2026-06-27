import process from 'node:process';
import { AgentExecutor } from '../AgentExecutor.js';
import { getLastAssistantText } from '../subAgentProfile.js';
import { createTeamBus } from './teamBus.js';
import { createTeamStateStore } from './teamStateStore.js';
import { emitTeamUpdate } from './teamUpdates.js';
import {
  EMPTY_TEAMMATE_RESULT,
  createTeammateFeatures,
  createTeammateSystemPrompt,
  selectTeammateTools,
} from './teammateProfile.js';

const defaultTeamBus = createTeamBus();
const defaultTeamStateStore = createTeamStateStore();

function getFinalAssistantTextAfterLastTool(messages) {
  const entries = Array.isArray(messages) ? messages : [];
  let lastToolIndex = -1;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i]?.role === 'assistant' && entries[i]?.type === 'tool_call') {
      lastToolIndex = i;
      break;
    }
  }

  const finalText = getLastAssistantText(entries);
  if (!finalText) return null;
  if (lastToolIndex === -1) return finalText;

  const finalTextIndex = entries.findLastIndex(message =>
    message?.role === 'assistant'
    && message?.type === 'text'
    && typeof message?.content === 'string'
    && message.content.trim()
  );

  return finalTextIndex > lastToolIndex ? finalText : null;
}

export function createTeammateHarnessId(parentHarnessId, teammateId) {
  const safeParentHarnessId = String(parentHarnessId || 'team')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80) || 'team';
  const safeTeammateId = String(teammateId || 'teammate')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80) || 'teammate';

  return `${safeParentHarnessId}_${safeTeammateId}`;
}

export async function runTeammate({
  parentExecutor,
  teamId,
  teammateId,
  name,
  role,
  initialPrompt,
  cwd = process.cwd(),
  maxTurns = 6,
  ExecutorClass = AgentExecutor,
  bus = defaultTeamBus,
  stateStore = defaultTeamStateStore,
}) {
  try {
    const startedAt = new Date().toISOString();
    await stateStore.updateTeammate({
      harnessId: parentExecutor.harnessId,
      teamId,
      agentId: teammateId,
      updates: { state: 'running', startedAt },
    });
    await emitTeamUpdate({
      executor: parentExecutor,
      stateStore,
      harnessId: parentExecutor.harnessId,
      teamId,
      fallbackTeammate: {
        agentId: teammateId,
        name,
        role: role ?? null,
        state: 'running',
        startedAt,
      },
    });

    const forwardChildEvent = (type, payload) => {
      if (type !== 'team_update') {
        return;
      }

      parentExecutor.onEvent(type, payload);
    };

    const teammateExecutor = new ExecutorClass({
      cwd,
      harnessId: createTeammateHarnessId(parentExecutor.harnessId, teammateId),
      runtimeRole: 'teammate',
      teamContext: {
        teamId,
        agentId: teammateId,
        leadId: 'lead',
        harnessId: parentExecutor.harnessId,
      },
      messages: [{ role: 'user', content: initialPrompt }],
      systemPrompt: createTeammateSystemPrompt({ name, role }),
      tools: selectTeammateTools(parentExecutor.tools),
      features: createTeammateFeatures(parentExecutor.features),
      model: parentExecutor.model,
      temperature: parentExecutor.temperature,
      maxTokens: parentExecutor.maxTokens,
      thinkingEnabled: parentExecutor.thinkingEnabled,
      skills: parentExecutor.skills,
      onEvent: forwardChildEvent,
    });

    await teammateExecutor.run(maxTurns);

    const finalText = getFinalAssistantTextAfterLastTool(teammateExecutor.messages);
    const content = finalText ?? EMPTY_TEAMMATE_RESULT;
    const finalState = teammateExecutor.lastRunStopReason === 'turn_limit'
      ? 'turn_limit'
      : (finalText ? 'completed' : 'no_result');
    const finalError = finalState === 'turn_limit'
      ? `Teammate exhausted max turns (${maxTurns}) before producing a final answer.`
      : null;
    const messageType = finalState === 'turn_limit' ? 'error' : 'result';

    await bus.sendMessage({
      harnessId: parentExecutor.harnessId,
      teamId,
      from: teammateId,
      to: 'lead',
      type: messageType,
      payload: finalState === 'turn_limit' ? {
        teammateId,
        name,
        role: role ?? null,
        error: finalError,
      } : {
        teammateId,
        name,
        role: role ?? null,
        content,
      },
    });

    await stateStore.updateTeammate({
      harnessId: parentExecutor.harnessId,
      teamId,
      agentId: teammateId,
      updates: {
        state: finalState,
        completedAt: new Date().toISOString(),
        lastResult: content,
        ...(finalError ? { error: finalError } : {}),
      },
    });
    await emitTeamUpdate({
      executor: parentExecutor,
      stateStore,
      harnessId: parentExecutor.harnessId,
      teamId,
      fallbackTeammate: {
        agentId: teammateId,
        name,
        role: role ?? null,
        state: finalState,
        lastResult: content,
        ...(finalError ? { error: finalError } : {}),
      },
    });
  } catch (error) {
    try {
      await bus.sendMessage({
        harnessId: parentExecutor.harnessId,
        teamId,
        from: teammateId,
        to: 'lead',
        type: 'error',
        payload: {
          teammateId,
          name,
          role: role ?? null,
          error: error.message,
        },
      });
    } catch (sendError) {
      console.error('[runTeammate] Failed to send teammate error envelope:', sendError);
    }

    try {
      await stateStore.updateTeammate({
        harnessId: parentExecutor.harnessId,
        teamId,
        agentId: teammateId,
        updates: { state: 'failed', completedAt: new Date().toISOString(), error: error.message },
      });
      await emitTeamUpdate({
        executor: parentExecutor,
        stateStore,
        harnessId: parentExecutor.harnessId,
        teamId,
        fallbackTeammate: {
          agentId: teammateId,
          name,
          role: role ?? null,
          state: 'failed',
          error: error.message,
        },
      });
    } catch (updateError) {
      console.error('[runTeammate] Failed to mark teammate as failed:', updateError);
    }

    throw error;
  }
}
