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
};

function getStrategyId(value) {
	const strategyId = String(value || DEFAULT_RUNTIME.strategy);
	return strategyId === 'custom' || KNOWLEDGE_RUNTIME_STRATEGIES[strategyId]
		? strategyId
		: DEFAULT_RUNTIME.strategy;
}

/**
 * Returns the durable knowledge-runtime configuration stored on a Harness.
 * Retrieval quality belongs to the knowledge base, while named strategies derive
 * their primitives at runtime instead of persisting redundant flags.
 */
export function compactKnowledgeRuntimeConfig(config = {}) {
	const raw = config && typeof config === 'object' ? config : { enabled: config };
	const strategy = getStrategyId(raw.strategy);
	const compact = {
		enabled: raw.enabled !== false,
		strategy,
	};

	if (strategy === 'custom') {
		compact.manifest_enabled = raw.manifest_enabled ?? DEFAULT_RUNTIME.manifest_enabled;
		compact.auto_retrieve = raw.auto_retrieve ?? DEFAULT_RUNTIME.auto_retrieve;
		compact.knowledge_tools = raw.knowledge_tools ?? DEFAULT_RUNTIME.knowledge_tools;
	}

	return compact;
}

export function compactKnowledgeRuntimeFeatures(features = {}) {
	if (!features || typeof features !== 'object' || !('knowledge_bases' in features)) {
		return features;
	}

	return {
		...features,
		knowledge_bases: compactKnowledgeRuntimeConfig(features.knowledge_bases),
	};
}

/**
 * Expands a compact persisted preset for configuration UI without changing the
 * durable representation. Custom strategies retain their explicit primitives.
 */
export function expandKnowledgeRuntimeConfig(config = {}) {
	const compact = compactKnowledgeRuntimeConfig(config);
	const preset = KNOWLEDGE_RUNTIME_STRATEGIES[compact.strategy];
	if (!preset) return compact;

	return {
		...compact,
		manifest_enabled: preset.manifest_enabled,
		auto_retrieve: preset.auto_retrieve,
		knowledge_tools: preset.knowledge_tools,
	};
}

export function applyKnowledgeRuntimeStrategy(features = {}, strategyId = 'agentic_rag') {
	const previous = features.knowledge_bases && typeof features.knowledge_bases === 'object'
		? features.knowledge_bases
		: {};
	if (strategyId === 'custom') {
		const previousRuntime = resolveKnowledgeRuntime(features);
		return {
			...features,
			knowledge_bases: {
				enabled: true,
				strategy: 'custom',
				manifest_enabled: previous.manifest_enabled ?? previousRuntime.manifestEnabled,
				auto_retrieve: previous.auto_retrieve ?? previousRuntime.autoRetrieve,
				knowledge_tools: previous.knowledge_tools ?? previousRuntime.knowledgeTools,
			},
		};
	}

	const preset = KNOWLEDGE_RUNTIME_STRATEGIES[strategyId] || KNOWLEDGE_RUNTIME_STRATEGIES.agentic_rag;

	return {
		...features,
		knowledge_bases: {
			enabled: true,
			strategy: preset.id,
		},
	};
}

export function resolveKnowledgeRuntime(features = {}) {
	const raw = compactKnowledgeRuntimeConfig(features.knowledge_bases);
	const strategy = raw.strategy;
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
