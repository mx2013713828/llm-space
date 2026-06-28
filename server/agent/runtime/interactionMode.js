const TRACE_INSPECTION_PATTERNS = [
  /为什么.*调用.*(tool|工具|read_file|bash|spawn_teammate)/i,
  /(刚才|上一轮|之前).*(调用|工具|轨迹|返回|输出)/i,
  /(解释|分析).*(执行轨迹|trajectory|tool call|工具调用)/i,
  /(teammate|sub-agent|sub_agent|子代理).*(为什么|返回了什么|没输出|只返回)/i,
];

const VALID_REQUESTED_MODES = new Set(['normal', 'trace_inspection']);

function getMessageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content)) {
    return message.content
      .filter(block => block?.type === 'text')
      .map(block => block.text || '')
      .join('\n');
  }
  return '';
}

export function resolveInteractionMode({ messages = [], requestedMode = '' } = {}) {
  const normalizedRequestedMode = String(requestedMode || '').trim();
  if (VALID_REQUESTED_MODES.has(normalizedRequestedMode) && normalizedRequestedMode !== 'normal') {
    return {
      mode: normalizedRequestedMode,
      toolPolicy: 'none',
      reason: 'explicit requested mode',
    };
  }

  const lastUser = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find(message => message?.role === 'user');
  const text = getMessageText(lastUser);
  const matched = TRACE_INSPECTION_PATTERNS.some(pattern => pattern.test(text));

  if (matched) {
    return {
      mode: 'trace_inspection',
      toolPolicy: 'none',
      reason: 'question about previous tool or trajectory behavior',
    };
  }

  return {
    mode: 'normal',
    toolPolicy: 'normal',
    reason: 'default',
  };
}

export function applyToolPolicyToContext(context, policy) {
  if (policy?.toolPolicy !== 'none') return;

  context.tools = [];
  context.systemPrompt = `${context.systemPrompt || ''}\n\n<runtime_contract>
This turn is trace inspection. Answer only from the existing conversation and persisted trajectory context. Do not call tools. If evidence is missing, say what is missing instead of attempting a new tool call.
</runtime_contract>`;
}
