import { AgentExecutor } from './AgentExecutor.js';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  getToolName,
} from '../../src/lib/taskOrchestration.js';
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
  const childFeatures = structuredClone(parentFeatures ?? {});

  childFeatures.task_orchestration = {
    ...(childFeatures.task_orchestration ?? {}),
    enabled: false,
    enable_sub_agents: false,
  };
  childFeatures.enable_memory = {
    ...(childFeatures.enable_memory ?? {}),
    enabled: false,
  };

  return childFeatures;
}

export function selectSubAgentTools(parentTools) {
  const tools = Array.isArray(parentTools) ? parentTools : [];
  return tools.filter(tool => !ORCHESTRATION_MANAGED_TOOL_NAMES.includes(getToolName(tool)));
}

export function getLastAssistantText(messages) {
  const entries = Array.isArray(messages) ? messages : [];

  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const message = entries[i];
    if (
      message?.role === 'assistant' &&
      message?.type === 'text' &&
      typeof message?.content === 'string' &&
      message.content.trim()
    ) {
      return message.content;
    }
  }

  return null;
}

function summarizePrompt(prompt = '') {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function createSubAgentEventForwarder(parentExecutor, parentToolCallId, startedAt) {
  let toolCount = 0;
  let previewTruncated = false;

  const forward = (type, payload = {}) => {
    parentExecutor.onEvent(type, {
      ...payload,
      parentToolCallId,
    });
  };

  const emitStatus = (patch) => {
    forward('sub_agent_status', {
      id: parentToolCallId,
      status: 'running',
      phase: 'running',
      toolCount,
      previewTruncated,
      startedAt,
      ...patch,
    });
  };

  return (subType, subPayload = {}) => {
    if (subType === 'messages_update') {
      return;
    }

    if (subType === 'thinking_start') {
      emitStatus({ phase: 'thinking', currentAction: 'thinking' });
      return;
    }

    if (subType === 'text_start') {
      emitStatus({ phase: 'finalizing', currentAction: 'writing final answer' });
      return;
    }

    if (subType === 'tool_start') {
      toolCount += 1;
      emitStatus({
        phase: 'tool_use',
        currentAction: subPayload.name ? `calling ${subPayload.name}` : 'calling tool',
        currentTool: subPayload.name || '',
      });
      return;
    }

    if (subType === 'tool_exec_start') {
      emitStatus({
        phase: 'tool_use',
        currentAction: subPayload.toolName ? `executing ${subPayload.toolName}` : 'executing tool',
        currentTool: subPayload.toolName || '',
      });
      return;
    }

    if (subType === 'tool_exec_done') {
      if (typeof subPayload.output === 'string' && subPayload.output.length > SUB_AGENT_STREAM_TOOL_OUTPUT_LIMIT) {
        previewTruncated = true;
      }
      emitStatus({
        phase: 'tool_result',
        currentAction: subPayload.toolName ? `finished ${subPayload.toolName}` : 'received tool result',
      });
      return;
    }

    if ((subType === 'thinking_delta' || subType === 'text_delta') && String(subPayload.text || '').length > SUB_AGENT_STREAM_TEXT_LIMIT) {
      previewTruncated = true;
    }
  };
}

export async function runSubAgent({ parentExecutor, tool, ExecutorClass = AgentExecutor }) {
  const startedAt = new Date().toISOString();
  const prompt = tool.toolInput.prompt;
  parentExecutor.onEvent('sub_agent_status', {
    id: tool.id,
    status: 'running',
    phase: 'starting',
    currentAction: summarizePrompt(prompt),
    toolCount: 0,
    previewTruncated: false,
    startedAt,
    parentToolCallId: tool.id,
  });

  const forwardSubAgentEvent = createSubAgentEventForwarder(parentExecutor, tool.id, startedAt);
  const subExecutor = new ExecutorClass({
    messages: [{ role: 'user', content: prompt }],
    systemPrompt: SUB_AGENT_SYSTEM_PROMPT,
    tools: selectSubAgentTools(parentExecutor.tools),
    features: createSubAgentFeatures(parentExecutor.features),
    model: parentExecutor.model,
    temperature: parentExecutor.temperature,
    maxTokens: parentExecutor.maxTokens,
    thinkingEnabled: parentExecutor.thinkingEnabled,
    skills: parentExecutor.skills,
    onEvent: forwardSubAgentEvent,
  });

  try {
    await subExecutor.run();
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
  const finalAnswer = getLastAssistantText(subExecutor.messages) ?? EMPTY_SUB_AGENT_RESULT;
  const traceRef = await saveSubAgentTrace({
    harnessId: parentExecutor.harnessId || 'default',
    parentToolCallId: tool.id,
    prompt,
    messages: subExecutor.messages,
    finalAnswer,
    startedAt,
    completedAt,
    status: 'completed',
  });

  tool.subAgentTrace = traceRef;
  tool.toolOutput = finalAnswer;
  parentExecutor.onEvent('sub_agent_trace_ready', {
    id: tool.id,
    status: 'completed',
    phase: 'completed',
    currentAction: 'completed',
    finalPreview: summarizePrompt(finalAnswer),
    trace: traceRef,
    toolCount: traceRef.summary.toolCallCount,
    startedAt,
    completedAt,
    parentToolCallId: tool.id,
  });
}
