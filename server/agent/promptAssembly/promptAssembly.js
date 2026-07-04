export function createPromptSection({
  id,
  label,
  target,
  lifecycle,
  source,
  content = '',
  order = 100,
  sentToModel = true,
  cacheImpact = 'stable',
  metadata = {},
} = {}) {
  const normalizedContent = String(content ?? '');
  return {
    id: String(id || '').trim(),
    label: String(label || id || '').trim(),
    target: String(target || 'system').trim(),
    lifecycle: String(lifecycle || 'pinned').trim(),
    source: String(source || '').trim(),
    content: normalizedContent,
    order: Number.isFinite(order) ? order : 100,
    sentToModel: sentToModel !== false,
    cacheImpact: String(cacheImpact || 'stable').trim(),
    chars: normalizedContent.length,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? { ...metadata } : {},
  };
}

export function appendSystemPromptSection(context, sectionInput) {
  if (!context || !sectionInput?.content) return;
  const section = createPromptSection(sectionInput);
  context.promptAssemblySections = Array.isArray(context.promptAssemblySections)
    ? context.promptAssemblySections
    : [];
  if (context.promptAssemblySections.some(item => item.id === section.id)) return;

  context.systemPrompt = context.systemPrompt
    ? `${context.systemPrompt}\n\n${section.content}`
    : section.content;
  context.promptAssemblySections.push(section);
}

export function composeSystemPromptSections({
  agentGuidance = '',
  guidanceFile = '',
  runtimeContext = '',
} = {}) {
  const sections = [];
  const guidanceText = String(agentGuidance || '');
  const runtimeText = String(runtimeContext || '');

  if (guidanceText) {
    sections.push(createPromptSection({
      id: 'agent_guidance',
      label: 'AGENTS.md',
      target: 'system',
      lifecycle: 'pinned',
      source: guidanceFile || 'legacy:systemPrompt',
      content: guidanceText,
      order: 10,
      cacheImpact: 'stable_until_guidance_changes',
    }));
  }

  if (runtimeText) {
    sections.push(createPromptSection({
      id: 'runtime_context',
      label: 'Runtime Context',
      target: 'system',
      lifecycle: 'pinned',
      source: 'runtime',
      content: runtimeText,
      order: 20,
      cacheImpact: 'changes_daily_or_environment',
    }));
  }

  return {
    text: sections.map(section => section.content).join('\n\n'),
    sections,
  };
}

export function summarizePromptAssembly(sections = []) {
  const seen = new Set();
  const normalized = [];

  for (const input of Array.isArray(sections) ? sections : []) {
    const section = createPromptSection(input);
    if (!section.id || seen.has(section.id)) continue;
    seen.add(section.id);
    normalized.push(section);
  }

  normalized.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return {
    sections: normalized,
    totals: {
      chars: normalized.reduce((sum, section) => sum + section.chars, 0),
      sentToModelChars: normalized
        .filter(section => section.sentToModel)
        .reduce((sum, section) => sum + section.chars, 0),
    },
  };
}
