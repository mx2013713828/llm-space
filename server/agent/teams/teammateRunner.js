import process from 'node:process';
import { AgentExecutor } from '../AgentExecutor.js';
import { createChildEventBridge } from '../child/childEventBridge.js';
import { createTeamBus } from './teamBus.js';
import { createTeamStateStore } from './teamStateStore.js';
import { emitTeamUpdate } from './teamUpdates.js';
import { buildTeammateOutcome } from './teammateOutcome.js';
import {
  EMPTY_TEAMMATE_RESULT,
  createTeammateProfile,
} from './teammateProfile.js';
import { saveTeammateTrace } from './teammateTraceStore.js';

const defaultTeamBus = createTeamBus();
const defaultTeamStateStore = createTeamStateStore();

export function createTeammateHarnessId(parentHarnessId, teammateId) {
  const safeParentHarnessId = String(parentHarnessId || 'team')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80) || 'team';
  const safeTeammateId = String(teammateId || 'teammate')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 80) || 'teammate';

  return `${safeParentHarnessId}_${safeTeammateId}`;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function shouldPublishTeammateChildStatus(patch = {}) {
  return patch.status === 'awaiting_permission' || patch.phase === 'permission_resolved';
}

export async function runTeammate({
  parentExecutor,
  teamId,
  teammateId,
  name,
  role,
  initialPrompt,
  cwd = process.cwd(),
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

    let statusUpdateQueue = Promise.resolve();
    const queueTeammateChildStatus = (patch = {}) => {
      if (!shouldPublishTeammateChildStatus(patch)) return;

      const updates = compactObject({
        state: patch.status === 'awaiting_permission' ? 'awaiting_permission' : 'running',
        phase: patch.phase,
        currentAction: patch.currentAction,
        currentTool: patch.currentTool,
        toolCount: patch.toolCount,
        previewTruncated: patch.previewTruncated,
      });
      statusUpdateQueue = statusUpdateQueue.catch(() => {}).then(async () => {
        try {
          await stateStore.updateTeammate({
            harnessId: parentExecutor.harnessId,
            teamId,
            agentId: teammateId,
            updates,
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
              state: updates.state,
              startedAt,
              ...updates,
            },
          });
        } catch (error) {
          console.error('[runTeammate] Failed to publish child status update:', error);
        }
      });
    };

    const forwardChildEvent = createChildEventBridge({
      parentExecutor,
      childType: 'teammate',
      childId: teammateId,
      name,
      role: role ?? null,
      teamId,
      onStatus: queueTeammateChildStatus,
      forwardEvents: ['team_update'],
    });

    const profile = createTeammateProfile({
      parentExecutor,
      teamId,
      teammateId,
      name,
      role: role ?? null,
      initialPrompt,
      cwd,
    });
    const teammateExecutor = new ExecutorClass({
      cwd: profile.cwd,
      harnessId: createTeammateHarnessId(parentExecutor.harnessId, teammateId),
      runtimeRole: profile.runtimeRole,
      teamContext: profile.teamContext,
      messages: profile.messages,
      systemPrompt: profile.systemPrompt,
      tools: profile.tools,
      features: profile.features,
      model: parentExecutor.model,
      temperature: parentExecutor.temperature,
      maxTokens: parentExecutor.maxTokens,
      thinkingEnabled: parentExecutor.thinkingEnabled,
      skills: parentExecutor.skills,
      onEvent: forwardChildEvent,
    });

    await teammateExecutor.run(Number.POSITIVE_INFINITY);
    await statusUpdateQueue;

    const outcome = buildTeammateOutcome({
      messages: teammateExecutor.messages,
      stopReason: teammateExecutor.lastRunStopReason,
    });
    const content = outcome.content || EMPTY_TEAMMATE_RESULT;
    const finalState = outcome.status;
    const finalError = outcome.error;
    const messageType = finalState === 'completed' ? 'result' : 'error';
    const completedAt = new Date().toISOString();
    const traceRef = await saveTeammateTrace({
      harnessId: parentExecutor.harnessId,
      teamId,
      teammateId,
      name,
      role: role ?? null,
      prompt: initialPrompt,
      messages: teammateExecutor.messages,
      finalAnswer: content,
      status: finalState,
      startedAt,
      completedAt,
    });

    await bus.sendMessage({
      harnessId: parentExecutor.harnessId,
      teamId,
      from: teammateId,
      to: 'lead',
      type: messageType,
      payload: finalState === 'completed' ? {
        teammateId,
        name,
        role: role ?? null,
        content,
        traceRef,
      } : {
        teammateId,
        name,
        role: role ?? null,
        error: finalError,
        status: finalState,
        lastToolName: outcome.lastToolName,
        traceRef,
      },
    });

    await stateStore.updateTeammate({
      harnessId: parentExecutor.harnessId,
      teamId,
      agentId: teammateId,
      updates: {
        state: finalState,
        completedAt,
        lastResult: content,
        traceRef,
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
        traceRef,
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
