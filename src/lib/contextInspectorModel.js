export function formatContextSize(chars = 0) {
  const value = Number(chars) || 0;
  if (value < 1000) return `${value} chars`;
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k chars`;
}

function getBlockText(block) {
  if (typeof block?.text === 'string') return block.text;
  if (typeof block?.content === 'string') return block.content;
  if (typeof block?.thinking === 'string') return block.thinking;
  return JSON.stringify(block ?? {}, null, 2);
}

function createMessageRow(message, index) {
  const blocks = Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content || '') }];
  const content = blocks.map((block, blockIndex) => {
    const type = block?.type || 'unknown';
    return `#${blockIndex + 1} ${type}\n${getBlockText(block)}`;
  }).join('\n\n');

  return {
    id: `message_${index}`,
    label: `${message.role || 'message'} #${index + 1}`,
    subtitle: `${blocks.length} block(s) · ${formatContextSize(content.length)}`,
    target: 'messages',
    lifecycle: 'payload',
    chars: content.length,
    content,
    kind: 'message',
  };
}

function createToolRow(tool, index) {
  const content = JSON.stringify(tool, null, 2);
  return {
    id: `tool_${tool?.name || index}`,
    label: tool?.name || `tool #${index + 1}`,
    subtitle: formatContextSize(content.length),
    target: 'tools',
    lifecycle: 'provider_schema',
    chars: content.length,
    content,
    kind: 'tool_schema',
  };
}

export function buildContextInspectorModel({
  promptAssembly = {},
  messages = [],
  tools = [],
} = {}) {
  const systemRows = (promptAssembly.sections || [])
    .filter(section => section?.sentToModel !== false && section?.target === 'system')
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(section => ({
      id: section.id,
      label: section.label || section.id,
      subtitle: `${section.source || 'unknown'} · ${section.lifecycle || 'pinned'} · ${formatContextSize(section.chars || section.content?.length || 0)}`,
      target: section.target,
      lifecycle: section.lifecycle || 'pinned',
      chars: section.chars || String(section.content || '').length,
      content: section.content || '',
      kind: 'prompt_section',
      cacheImpact: section.cacheImpact || '',
    }));

  const messageRows = (messages || []).map(createMessageRow);
  const toolRows = (tools || []).map(createToolRow);

  const groups = [
    { id: 'system', label: 'System Prompt', rows: systemRows },
    { id: 'messages', label: 'Messages Payload', rows: messageRows },
    { id: 'tools', label: 'Provider Tool Schema', rows: toolRows },
  ];
  const firstRow = groups.flatMap(group => group.rows)[0] || null;

  return {
    groups,
    defaultSelectionId: firstRow?.id || '',
  };
}
