import { AgentExecutor } from './AgentExecutor.js';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  getToolName,
} from '../../src/lib/taskOrchestration.js';

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

function createSubAgentEventForwarder(parentExecutor, parentToolCallId) {
  const textLengths = new Map();
  const toolOutputLengths = new Map();
  const truncatedKeys = new Set();

  const forward = (type, payload) => {
    parentExecutor.onEvent(type, {
      ...payload,
      parentToolCallId,
    });
  };

  const emitTruncationNotice = (key, message) => {
    if (truncatedKeys.has(key)) return;
    truncatedKeys.add(key);
    forward('text_start', { turn: 0 });
    forward('text_delta', { text: message });
  };

  return (subType, subPayload = {}) => {
    if (subType === 'messages_update') {
      return;
    }

    if (subType === 'thinking_delta' || subType === 'text_delta') {
      const key = subType;
      const limit = SUB_AGENT_STREAM_TEXT_LIMIT;
      const currentLength = textLengths.get(key) || 0;
      const incoming = String(subPayload.text || '');
      const remaining = limit - currentLength;

      if (remaining <= 0) {
        emitTruncationNotice(
          `${key}:truncated`,
          '\n\n[Sub-agent preview truncated to keep the UI responsive. See the parent tool output for the final result.]'
        );
        return;
      }

      const nextText = incoming.slice(0, remaining);
      textLengths.set(key, currentLength + nextText.length);
      forward(subType, { ...subPayload, text: nextText });

      if (incoming.length > remaining) {
        emitTruncationNotice(
          `${key}:truncated`,
          '\n\n[Sub-agent preview truncated to keep the UI responsive. See the parent tool output for the final result.]'
        );
      }
      return;
    }

    if (subType === 'tool_exec_chunk') {
      const key = subPayload.id || 'unknown-tool';
      const currentLength = toolOutputLengths.get(key) || 0;
      const incoming = String(subPayload.content || '');
      const remaining = SUB_AGENT_STREAM_TOOL_OUTPUT_LIMIT - currentLength;

      if (remaining <= 0) return;

      const nextContent = incoming.slice(0, remaining);
      toolOutputLengths.set(key, currentLength + nextContent.length);
      forward(subType, { ...subPayload, content: nextContent });

      if (incoming.length > remaining) {
        forward('tool_exec_chunk', {
          ...subPayload,
          content: '\n\n[Sub-agent tool output preview truncated to keep the UI responsive.]',
        });
      }
      return;
    }

    if (subType === 'tool_exec_done' && typeof subPayload.output === 'string') {
      const output = subPayload.output;
      const preview = output.length > SUB_AGENT_STREAM_TOOL_OUTPUT_LIMIT
        ? `${output.slice(0, SUB_AGENT_STREAM_TOOL_OUTPUT_LIMIT)}\n\n[Sub-agent tool output preview truncated to keep the UI responsive.]`
        : output;
      forward(subType, { ...subPayload, output: preview });
      return;
    }

    forward(subType, subPayload);
  };
}

export async function runSubAgent({ parentExecutor, tool, ExecutorClass = AgentExecutor }) {
  const forwardSubAgentEvent = createSubAgentEventForwarder(parentExecutor, tool.id);
  const subExecutor = new ExecutorClass({
    messages: [{ role: 'user', content: tool.toolInput.prompt }],
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

  await subExecutor.run();

  tool.toolOutput = getLastAssistantText(subExecutor.messages) ?? EMPTY_SUB_AGENT_RESULT;
}
