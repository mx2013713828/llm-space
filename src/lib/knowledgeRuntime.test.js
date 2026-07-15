import test from 'node:test';
import assert from 'node:assert/strict';

import {
	KNOWLEDGE_RUNTIME_STRATEGIES,
	applyKnowledgeRuntimeStrategy,
	compactKnowledgeRuntimeConfig,
	compactKnowledgeRuntimeFeatures,
	resolveKnowledgeRuntime,
} from './knowledgeRuntime.js';
import { parseFeatures } from './FeatureSchema.js';

test('knowledge runtime strategies expose the three supported presets', () => {
	assert.deepEqual(Object.keys(KNOWLEDGE_RUNTIME_STRATEGIES), [
		'auto_rag',
		'agentic_rag',
		'manual_lab',
	]);
});

test('auto_rag enables manifest and automatic retrieval but hides tools', () => {
	const features = applyKnowledgeRuntimeStrategy({}, 'auto_rag');
	assert.deepEqual(resolveKnowledgeRuntime(features), {
		enabled: true,
		strategy: 'auto_rag',
		manifestEnabled: true,
		autoRetrieve: true,
		knowledgeTools: false,
	});
});

test('agentic_rag enables manifest and knowledge tools without auto retrieval', () => {
	const features = applyKnowledgeRuntimeStrategy({}, 'agentic_rag');
	assert.equal(resolveKnowledgeRuntime(features).manifestEnabled, true);
	assert.equal(resolveKnowledgeRuntime(features).autoRetrieve, false);
	assert.equal(resolveKnowledgeRuntime(features).knowledgeTools, true);
});

test('manual_lab disables model-bound knowledge primitives', () => {
	const features = applyKnowledgeRuntimeStrategy({}, 'manual_lab');
	assert.equal(resolveKnowledgeRuntime(features).manifestEnabled, false);
	assert.equal(resolveKnowledgeRuntime(features).autoRetrieve, false);
	assert.equal(resolveKnowledgeRuntime(features).knowledgeTools, false);
});

test('custom strategy keeps the current primitive mix', () => {
	const features = applyKnowledgeRuntimeStrategy({
		knowledge_bases: {
			auto_retrieve: true,
			knowledge_tools: false,
		},
	}, 'custom');
	const runtime = resolveKnowledgeRuntime(features);

	assert.equal(runtime.strategy, 'custom');
	assert.equal(runtime.autoRetrieve, true);
	assert.equal(runtime.knowledgeTools, false);
});

test('custom strategy ignores legacy runtime retrieval bounds', () => {
	const runtime = resolveKnowledgeRuntime({
		knowledge_bases: {
			enabled: true,
			strategy: 'custom',
			manifest_enabled: true,
			auto_retrieve: true,
			knowledge_tools: true,
			topK: 3,
			maxChars: 1200,
			scoreThreshold: 0.25,
		},
	});

	assert.equal(runtime.strategy, 'custom');
	assert.equal('topK' in runtime, false);
	assert.equal('maxChars' in runtime, false);
	assert.equal('scoreThreshold' in runtime, false);
});

test('preset knowledge runtime configs persist only enablement and strategy', () => {
	const compact = compactKnowledgeRuntimeConfig({
		enabled: true,
		strategy: 'auto_rag',
		manifest_enabled: true,
		auto_retrieve: true,
		knowledge_tools: false,
		topK: 40,
		maxChars: 8000,
		scoreThreshold: 0.25,
	});

	assert.deepEqual(compact, {
		enabled: true,
		strategy: 'auto_rag',
	});
	assert.deepEqual(applyKnowledgeRuntimeStrategy({
		knowledge_bases: {
			topK: 40,
			auto_retrieve: false,
		},
	}, 'agentic_rag').knowledge_bases, {
		enabled: true,
		strategy: 'agentic_rag',
	});
});

test('custom knowledge runtime configs retain only explicit primitives', () => {
	const compact = compactKnowledgeRuntimeFeatures({
		parallel_tool_execution: true,
		knowledge_bases: {
			enabled: true,
			strategy: 'custom',
			manifest_enabled: false,
			auto_retrieve: true,
			knowledge_tools: false,
			topK: 40,
		},
	});

	assert.deepEqual(compact, {
		parallel_tool_execution: true,
		knowledge_bases: {
			enabled: true,
			strategy: 'custom',
			manifest_enabled: false,
			auto_retrieve: true,
			knowledge_tools: false,
		},
	});
});

test('parseFeatures removes legacy runtime retrieval bounds', () => {
	const parsed = parseFeatures({
		knowledge_bases: {
			strategy: 'auto_rag',
			topK: '3',
			maxChars: '1200',
			scoreThreshold: '0.25',
		},
	});

	assert.equal(parsed.knowledge_bases.enabled, true);
	assert.equal(parsed.knowledge_bases.strategy, 'auto_rag');
	assert.equal('topK' in parsed.knowledge_bases, false);
	assert.equal('maxChars' in parsed.knowledge_bases, false);
	assert.equal('scoreThreshold' in parsed.knowledge_bases, false);
});

test('parseFeatures expands presets for UI but preserves custom primitive state', () => {
	const autoRag = parseFeatures({
		knowledge_bases: { enabled: true, strategy: 'auto_rag' },
	});
	assert.equal(autoRag.knowledge_bases.auto_retrieve, true);
	assert.equal(autoRag.knowledge_bases.knowledge_tools, false);

	const custom = parseFeatures({
		knowledge_bases: {
			enabled: true,
			strategy: 'custom',
			manifest_enabled: false,
			auto_retrieve: true,
			knowledge_tools: false,
		},
	});
	assert.equal(custom.knowledge_bases.manifest_enabled, false);
	assert.equal(custom.knowledge_bases.auto_retrieve, true);
	assert.equal(custom.knowledge_bases.knowledge_tools, false);
});
