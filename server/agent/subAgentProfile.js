import { AgentExecutor } from './AgentExecutor.js';
import {
  createChildAgentProfile,
  createChildFeatures,
} from './child/childAgentProfile.js';
import { assembleToolPool } from './toolPool.js';
import { createChildEventBridge } from './child/childEventBridge.js';
import { buildChildOutcome } from './child/childOutcome.js';
import { createScratchWorkspacePolicy } from './child/scratchWorkspacePolicy.js';
import { saveSubAgentTrace } from './subagents/subAgentTraceStore.js';

const EMPTY_SUB_AGENT_RESULT = '(子代理运行完毕，未返回任何文字总结)';
export const SUB_AGENT_STREAM_TEXT_LIMIT = 6000;
export const SUB_AGENT_STREAM_TOOL_OUTPUT_LIMIT = 8000;

const SUB_AGENT_SYSTEM_PROMPT = [
  'You are a one-off sub-agent.',
  'You may use the provided tools to complete the assigned task.',
  'You are forbidden to delegate, invoke sub-agents, or create background teammates.',
  'Do not ask for teammate help.',
  'When you are done, return a concise final answer to the parent agent.',
].join(' ');

export function createSubAgentFeatures(parentFeatures) {
  return createChildFeatures(parentFeatures, {
    taskOrchestration: {
      enabled: false,
      enable_sub_agents: false,
    },
    memoryEnabled: false,
  });
}

export function selectSubAgentTools(parentTools) {
  return assembleToolPool({
    baseTools: parentTools,
    runtimeRole: 'sub_agent',
  }).tools;
}

export function createSubAgentProfile({ parentExecutor, prompt, childId }) {
  return createChildAgentProfile({
    childType: 'sub_agent',
    childId,
    parentHarnessId: parentExecutor.harnessId || 'default',
    prompt,
    systemPrompt: SUB_AGENT_SYSTEM_PROMPT,
    parentTools: parentExecutor.tools,
    parentFeatures: parentExecutor.features,
    featurePolicy: {
      taskOrchestration: {
        enabled: false,
        enable_sub_agents: false,
      },
      memoryEnabled: false,
    },
    toolPolicy: {
      runtimeRole: 'sub_agent',
    },
    scratchWorkspace: createScratchWorkspacePolicy({
      runId: parentExecutor.harnessId || 'default',
      childId,
    }),
    extra: {
      runtimeRole: 'sub_agent',
    },
  });
}

export function getLastAssistantText(messages) {
  const outcome = buildChildOutcome({
    messages,
    requireFinalText: false,
  });
  return outcome.content || null;
}

function summarizePrompt(prompt = '') {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function createSubAgentEventForwarder(parentExecutor, parentToolCallId, startedAt) {
  return createChildEventBridge({
    parentExecutor,
    childType: 'sub_agent',
    childId: parentToolCallId,
    parentToolCallId,
    startedAt,
    textPreviewLimit: SUB_AGENT_STREAM_TEXT_LIMIT,
    toolOutputPreviewLimit: SUB_AGENT_STREAM_TOOL_OUTPUT_LIMIT,
    onStatus(patch) {
      parentExecutor.onEvent('sub_agent_status', {
        id: parentToolCallId,
        ...patch,
        parentToolCallId,
      });
    },
  });
}

function emitInitialSubAgentStatus(parentExecutor, parentToolCallId, startedAt, patch) {
  parentExecutor.onEvent('sub_agent_status', {
    id: parentToolCallId,
    parentToolCallId,
    startedAt,
    ...patch,
  });
}

export async function runSubAgent({ parentExecutor, tool, ExecutorClass = AgentExecutor }) {
  const startedAt = new Date().toISOString();
  const prompt = tool.toolInput.prompt;
  emitInitialSubAgentStatus(parentExecutor, tool.id, startedAt, {
    status: 'running',
    phase: 'starting',
    currentAction: summarizePrompt(prompt),
    toolCount: 0,
    previewTruncated: false,
  });

  const forwardSubAgentEvent = createSubAgentEventForwarder(parentExecutor, tool.id, startedAt);
  const profile = createSubAgentProfile({
    parentExecutor,
    prompt,
    childId: tool.id,
  });
  const subExecutor = new ExecutorClass({
    messages: profile.messages,
    systemPrompt: profile.systemPrompt,
    tools: profile.tools,
    features: profile.features,
    model: parentExecutor.model,
    temperature: parentExecutor.temperature,
    maxTokens: parentExecutor.maxTokens,
    thinkingEnabled: parentExecutor.thinkingEnabled,
    skills: parentExecutor.skills,
    onEvent: forwardSubAgentEvent,
  });

  try {
    await subExecutor.run(Number.POSITIVE_INFINITY);
  } catch (err) {
    const completedAt = new Date().toISOString();
    const finalAnswer = `[子代理异常崩溃]\n${err.message}`;
    try {
      const traceRef = await saveSubAgentTrace({
        harnessId: parentExecutor.harnessId || 'default',
        parentToolCallId: tool.id,
        prompt,
        messages: subExecutor.messages,
        finalAnswer,
        startedAt,
        completedAt,
        status: 'failed',
      });

      tool.subAgentTrace = traceRef;
      parentExecutor.onEvent('sub_agent_trace_ready', {
        id: tool.id,
        status: 'failed',
        phase: 'failed',
        currentAction: err.message,
        finalPreview: summarizePrompt(finalAnswer),
        trace: traceRef,
        toolCount: traceRef.summary.toolCallCount,
        startedAt,
        completedAt,
        parentToolCallId: tool.id,
      });
    } catch {
      parentExecutor.onEvent('sub_agent_status', {
        id: tool.id,
        status: 'failed',
        phase: 'failed',
        currentAction: err.message,
        startedAt,
        completedAt,
        parentToolCallId: tool.id,
      });
    }
    throw err;
  }

  const completedAt = new Date().toISOString();
  const outcome = buildChildOutcome({
    messages: subExecutor.messages,
    stopReason: subExecutor.lastRunStopReason,
    childLabel: 'Sub-agent',
  });
  const finalAnswer = outcome.content || EMPTY_SUB_AGENT_RESULT;
  const traceRef = await saveSubAgentTrace({
    harnessId: parentExecutor.harnessId || 'default',
    parentToolCallId: tool.id,
    prompt,
    messages: subExecutor.messages,
    finalAnswer,
    startedAt,
    completedAt,
    status: outcome.status,
  });

  tool.subAgentTrace = traceRef;
  tool.toolOutput = finalAnswer;
  parentExecutor.onEvent('sub_agent_trace_ready', {
    id: tool.id,
    status: outcome.status,
    phase: outcome.status === 'completed' ? 'completed' : outcome.status,
    currentAction: outcome.error || outcome.status,
    finalPreview: summarizePrompt(finalAnswer),
    trace: traceRef,
    toolCount: traceRef.summary.toolCallCount,
    startedAt,
    completedAt,
    parentToolCallId: tool.id,
  });
}
