const MAX_TOOL_CHIPS = 6;

export function getRunControlPresentation(runControl = {}) {
	if (runControl?.status !== 'paused') return { visible: false };
	const description = String(runControl?.checkpoint?.nextAction?.description || '').trim();
	if (!description) return { visible: false };

	const tools = (Array.isArray(runControl.checkpoint?.tools) ? runControl.checkpoint.tools : [])
		.map(tool => String(tool?.name || '').trim())
		.filter(Boolean)
		.slice(0, MAX_TOOL_CHIPS);

	return {
		visible: true,
		phaseLabel: 'Awaiting next step',
		nextDescription: description,
		tools,
		primaryLabel: 'Next step',
	};
}
