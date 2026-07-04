import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryPlugin,
  injectMemoryContext,
  isStaticContextInspection,
  shouldDisableMemoryForTurn,
  stripApiMemoryContexts,
  stripPersistedMemoryContexts,
} from './MemoryPlugin.js';

test('injects memory into API messages without changing persisted user messages', () => {
  const persisted = [{ role: 'user', type: 'scheduled', content: '[Scheduled] weather' }];
  const apiMessages = [{ role: 'user', content: [{ type: 'text', text: '[Scheduled] weather' }] }];

  injectMemoryContext(apiMessages, ['remember Linyi']);

  assert.equal(persisted[0].content, '[Scheduled] weather');
  assert.match(apiMessages[0].content[0].text, /^<memory_context>/);
  assert.match(apiMessages[0].content[0].text, /remember Linyi/);
  assert.match(apiMessages[0].content[0].text, /\[Scheduled\] weather$/);
});

test('removes repeated leaked memory blocks from persisted messages', () => {
  const messages = [{
    role: 'user',
    type: 'scheduled',
    content: '<memory_context>first</memory_context>\n\n<memory_context>second</memory_context>\n\n[Scheduled] weather'
  }];

  assert.equal(stripPersistedMemoryContexts(messages), true);
  assert.equal(messages[0].content, '[Scheduled] weather');
});

test('removes legacy memory blocks from an already-built API context', () => {
  const apiMessages = [{
    role: 'user',
    content: [{ type: 'text', text: '<memory_context>old</memory_context>\n\n[Scheduled] weather' }]
  }];

  stripApiMemoryContexts(apiMessages);

  assert.equal(apiMessages[0].content[0].text, '[Scheduled] weather');
});

test('disables memory injection and extraction for trace inspection turns', () => {
  assert.equal(shouldDisableMemoryForTurn({
    interactionMode: { mode: 'trace_inspection', toolPolicy: 'none' },
  }), true);
  assert.equal(shouldDisableMemoryForTurn({
    interactionMode: { mode: 'normal', toolPolicy: 'normal' },
  }), false);
});

test('detects static context inspection dry-run mode', () => {
  assert.equal(isStaticContextInspection({ dryRunMode: 'static_context' }), true);
  assert.equal(isStaticContextInspection({ dryRunMode: '' }), false);
});

test('static context inspection injects memory index but skips memory side-query', async () => {
  let selectCalled = false;
  const context = {
    executor: {
      harnessId: 'h1',
      dryRunMode: 'static_context',
      features: { enable_memory: { enabled: true } },
      messages: [{ role: 'user', content: 'hello' }],
      onEvent: () => {},
      _callLLMNonStream: async () => {
        throw new Error('LLM should not be called in static context inspection');
      },
      memoryDependencies: {
        readIndex: async () => '- [stable](stable.md) — Stable memory',
        selectAndLoadMemories: async () => {
          selectCalled = true;
          return ['should not be selected'];
        },
      },
    },
    apiMessages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    systemPrompt: '',
    promptAssemblySections: [],
  };

  await MemoryPlugin.preLLM(context);

  assert.equal(selectCalled, false);
  assert.match(context.systemPrompt, /<memory_index>/);
  assert.equal(JSON.stringify(context.apiMessages).includes('<memory_context>'), false);
  assert.equal(
    context.promptAssemblySections.some(section => section.id === 'memory_index'),
    true,
  );
});
