import { resolveKnowledgeRuntime } from './knowledgeRuntime.js';

/**
 * Derives the visible Harness lifecycle from the same feature shape used by
 * runtime plugins. The visualizer consumes this model instead of legacy flags.
 */
export function buildHarnessArchitecture(features = {}, { tools = [], skills = [] } = {}) {
	const knowledgeRuntime = resolveKnowledgeRuntime(features);
	const hasTools = Array.isArray(tools) && tools.length > 0;
	const orchestration = features.task_orchestration || {};

	return {
		hasTools,
		skillCount: Array.isArray(skills) ? skills.length : 0,
		memoryEnabled: features.enable_memory?.enabled !== false,
		skillsEnabled: features.enable_skills?.enabled !== false,
		compactionEnabled: features.context_compaction?.enabled !== false,
		taskOrchestrationEnabled: Boolean(orchestration.mode && orchestration.mode !== 'none'),
		hasTeams: Boolean(orchestration.enable_agent_teams),
		knowledge: {
			enabled: knowledgeRuntime.enabled,
			strategy: knowledgeRuntime.strategy,
			showManifest: knowledgeRuntime.enabled && knowledgeRuntime.manifestEnabled,
			showQueryPreparation: knowledgeRuntime.enabled && knowledgeRuntime.autoRetrieve,
			showRetrieval: knowledgeRuntime.enabled && knowledgeRuntime.autoRetrieve,
			showRerank: knowledgeRuntime.enabled && knowledgeRuntime.autoRetrieve,
			showInjectionGate: knowledgeRuntime.enabled && knowledgeRuntime.autoRetrieve,
			showKnowledgeTools: knowledgeRuntime.enabled && knowledgeRuntime.knowledgeTools,
		},
	};
}
