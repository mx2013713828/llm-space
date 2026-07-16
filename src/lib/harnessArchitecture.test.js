import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHarnessArchitecture } from './harnessArchitecture.js';

test('auto RAG exposes its pre-LLM query preparation pipeline', () => {
	const architecture = buildHarnessArchitecture({
		knowledge_bases: {
			enabled: true,
			strategy: 'auto_rag',
		},
	}, { tools: ['bash'] });

	assert.deepEqual(architecture.knowledge, {
		enabled: true,
		strategy: 'auto_rag',
		showManifest: true,
		showQueryPreparation: true,
		showRetrieval: true,
		showRerank: true,
		showInjectionGate: true,
		showKnowledgeTools: false,
	});
});

test('agentic RAG exposes knowledge tools without pretending to auto retrieve', () => {
	const architecture = buildHarnessArchitecture({
		knowledge_bases: {
			enabled: true,
			strategy: 'agentic_rag',
		},
	}, { tools: ['bash'] });

	assert.equal(architecture.knowledge.showManifest, true);
	assert.equal(architecture.knowledge.showQueryPreparation, false);
	assert.equal(architecture.knowledge.showRetrieval, false);
	assert.equal(architecture.knowledge.showKnowledgeTools, true);
});

test('legacy enable_rag flags do not activate the knowledge architecture', () => {
	const architecture = buildHarnessArchitecture({
		enable_rag: { auto_rag: true },
		knowledge_bases: { enabled: false, strategy: 'auto_rag' },
	});

	assert.equal(architecture.knowledge.enabled, false);
	assert.equal(architecture.knowledge.showQueryPreparation, false);
});
