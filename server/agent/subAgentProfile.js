import { AgentExecutor } from './AgentExecutor.js';
import {
  ORCHESTRATION_MANAGED_TOOL_NAMES,
  getToolName,
} from '../../src/lib/taskOrchestration.js';

const EMPTY_SUB_AGENT_RESULT = '(子代理运行完毕，未返回任何文字总结)';

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

export async function runSubAgent({ parentExecutor, tool, ExecutorClass = AgentExecutor }) {
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
    onEvent: (subType, subPayload) => {
      parentExecutor.onEvent(subType, {
        ...subPayload,
        parentToolCallId: tool.id,
      });
    },
  });

  await subExecutor.run();

  tool.toolOutput = getLastAssistantText(subExecutor.messages) ?? EMPTY_SUB_AGENT_RESULT;
}
