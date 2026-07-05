import test from 'node:test';
import assert from 'node:assert/strict';

import {
	KNOWLEDGE_RUNTIME_STRATEGIES,
	applyKnowledgeRuntimeStrategy,
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
		topK: 5,
		maxChars: 8000,
		scoreThreshold: 0,
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

test('custom settings preserve numeric retrieval bounds', () => {
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
	assert.equal(runtime.topK, 3);
	assert.equal(runtime.maxChars, 1200);
	assert.equal(runtime.scoreThreshold, 0.25);
});

test('parseFeatures normalizes knowledge runtime defaults and numeric settings', () => {
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
	assert.equal(parsed.knowledge_bases.topK, 3);
	assert.equal(parsed.knowledge_bases.maxChars, 1200);
	assert.equal(parsed.knowledge_bases.scoreThreshold, 0.25);
});
