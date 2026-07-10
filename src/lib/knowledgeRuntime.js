export const KNOWLEDGE_RUNTIME_STRATEGIES = {
	auto_rag: {
		id: 'auto_rag',
		name: 'Auto RAG',
		description: 'Automatically retrieve mounted knowledge every user turn.',
		manifest_enabled: true,
		auto_retrieve: true,
		knowledge_tools: false,
	},
	agentic_rag: {
		id: 'agentic_rag',
		name: 'Agentic RAG',
		description: 'Expose knowledge tools and let the agent decide when to query.',
		manifest_enabled: true,
		auto_retrieve: false,
		knowledge_tools: true,
	},
	manual_lab: {
		id: 'manual_lab',
		name: 'Manual Lab',
		description: 'Keep knowledge experiments in the Knowledge page only.',
		manifest_enabled: false,
		auto_retrieve: false,
		knowledge_tools: false,
	},
};

const DEFAULT_RUNTIME = {
	enabled: true,
	strategy: 'agentic_rag',
	manifest_enabled: true,
	auto_retrieve: false,
	knowledge_tools: true,
	topK: 5,
	maxChars: 8000,
	scoreThreshold: 0,
};

export function applyKnowledgeRuntimeStrategy(features = {}, strategyId = 'agentic_rag') {
	const previous = features.knowledge_bases && typeof features.knowledge_bases === 'object'
		? features.knowledge_bases
		: {};
	if (strategyId === 'custom') {
		return {
			...features,
			knowledge_bases: {
				...previous,
				enabled: true,
				strategy: 'custom',
				manifest_enabled: previous.manifest_enabled ?? DEFAULT_RUNTIME.manifest_enabled,
				auto_retrieve: previous.auto_retrieve ?? DEFAULT_RUNTIME.auto_retrieve,
				knowledge_tools: previous.knowledge_tools ?? DEFAULT_RUNTIME.knowledge_tools,
				topK: normalizeInteger(previous.topK, DEFAULT_RUNTIME.topK),
				maxChars: normalizeInteger(previous.maxChars, DEFAULT_RUNTIME.maxChars),
				scoreThreshold: normalizeNumber(previous.scoreThreshold, DEFAULT_RUNTIME.scoreThreshold),
			},
		};
	}

	const preset = KNOWLEDGE_RUNTIME_STRATEGIES[strategyId] || KNOWLEDGE_RUNTIME_STRATEGIES.agentic_rag;

	return {
		...features,
		knowledge_bases: {
			...previous,
			enabled: true,
			strategy: preset.id,
			manifest_enabled: preset.manifest_enabled,
			auto_retrieve: preset.auto_retrieve,
			knowledge_tools: preset.knowledge_tools,
			topK: normalizeInteger(previous.topK, DEFAULT_RUNTIME.topK),
			maxChars: normalizeInteger(previous.maxChars, DEFAULT_RUNTIME.maxChars),
			scoreThreshold: normalizeNumber(previous.scoreThreshold, DEFAULT_RUNTIME.scoreThreshold),
		},
	};
}

export function resolveKnowledgeRuntime(features = {}) {
	const raw = features.knowledge_bases && typeof features.knowledge_bases === 'object'
		? features.knowledge_bases
		: {};
	const strategy = raw.strategy || DEFAULT_RUNTIME.strategy;
	const preset = KNOWLEDGE_RUNTIME_STRATEGIES[strategy];
	const merged = {
		...DEFAULT_RUNTIME,
		...(preset ? {
			strategy: preset.id,
			manifest_enabled: preset.manifest_enabled,
			auto_retrieve: preset.auto_retrieve,
			knowledge_tools: preset.knowledge_tools,
		} : { strategy }),
		...raw,
	};

	return {
		enabled: merged.enabled !== false,
		strategy: String(merged.strategy || DEFAULT_RUNTIME.strategy),
		manifestEnabled: !!merged.manifest_enabled,
		autoRetrieve: !!merged.auto_retrieve,
		knowledgeTools: !!merged.knowledge_tools,
		topK: normalizeInteger(merged.topK, DEFAULT_RUNTIME.topK),
		maxChars: normalizeInteger(merged.maxChars, DEFAULT_RUNTIME.maxChars),
		scoreThreshold: normalizeNumber(merged.scoreThreshold, DEFAULT_RUNTIME.scoreThreshold),
	};
}

export function getKnowledgeStrategySummary(strategyId = 'agentic_rag') {
	if (strategyId === 'auto_rag') {
		return { name: 'Auto RAG', detail: 'Manifest pinned, auto retrieval on each turn' };
	}
	if (strategyId === 'manual_lab') {
		return { name: 'Manual Lab', detail: 'Knowledge stays in the lab surface' };
	}
	if (strategyId === 'custom') {
		return { name: 'Custom', detail: 'Manual mix of manifest, retrieval, and tools' };
	}
	return { name: 'Agentic RAG', detail: 'Manifest pinned, retrieval via tools' };
}

function normalizeInteger(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : fallback;
}

function normalizeNumber(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}
