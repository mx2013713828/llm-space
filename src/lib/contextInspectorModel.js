export function formatContextSize(chars = 0) {
  const value = Number(chars) || 0;
  if (value < 1000) return `${value} chars`;
  return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k chars`;
}

export function getActiveTranscriptItemId(positions = [], scrollTop = 0, anchorOffset = 72) {
  if (!positions.length) return '';

  const anchor = scrollTop + anchorOffset;
  let active = positions[0];

  for (const position of positions) {
    if (position.top <= anchor) {
      active = position;
    } else {
      break;
    }
  }

  return active?.id || '';
}

export function getTranscriptBlockDisplayKind(type = '') {
  if (type === 'thinking') return 'thinking';
  if (type === 'tool_use' || type === 'tool_result') return 'tool';
  if (type === 'text') return 'text';
  return 'data';
}

function getBlockText(block) {
  if (typeof block?.text === 'string') return block.text;
  if (typeof block?.content === 'string') return block.content;
  if (typeof block?.thinking === 'string') return block.thinking;
  return JSON.stringify(block ?? {}, null, 2);
}

function normalizeMessageBlocks(message) {
  return Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: String(message.content || '') }];
}

function createTranscriptBlock(block, index) {
  const type = block?.type || 'unknown';
  const text = getBlockText(block);
  return {
    id: `block_${index}`,
    type,
    displayKind: getTranscriptBlockDisplayKind(type),
    text,
    chars: text.length,
  };
}

function createMessageTranscriptItem(message, index) {
  const blocks = normalizeMessageBlocks(message).map(createTranscriptBlock);
  const content = blocks.map((block, blockIndex) => {
    return `#${blockIndex + 1} ${block.type}\n${block.text}`;
  }).join('\n\n');

  return {
    id: `message_${index}`,
    label: `${message.role || 'message'} #${index + 1}`,
    role: message.role || 'message',
    index,
    subtitle: `${blocks.length} block(s) · ${formatContextSize(content.length)}`,
    blocks,
    chars: content.length,
    content,
  };
}

function createMessageRow(message, index) {
  const item = createMessageTranscriptItem(message, index);

  return {
    id: item.id,
    label: item.label,
    subtitle: item.subtitle,
    target: 'messages',
    lifecycle: 'payload',
    chars: item.chars,
    content: item.content,
    kind: 'message',
    messageIndex: index,
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

  const messageTranscriptItems = (messages || []).map(createMessageTranscriptItem);
  const messageRows = messageTranscriptItems.map(item => ({
    id: item.id,
    label: item.label,
    subtitle: item.subtitle,
    target: 'messages',
    lifecycle: 'payload',
    chars: item.chars,
    content: item.content,
    kind: 'message',
    messageIndex: item.index,
  }));
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
    messageTranscript: {
      items: messageTranscriptItems,
      content: messageTranscriptItems.map(item => {
        return `#${item.index + 1} ${item.role}\n${item.content}`;
      }).join('\n\n---\n\n'),
      chars: messageTranscriptItems.reduce((total, item) => total + item.chars, 0),
    },
  };
}
