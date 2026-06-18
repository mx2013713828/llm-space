import test from 'node:test';
import assert from 'node:assert/strict';
import { injectMemoryContext, stripApiMemoryContexts, stripPersistedMemoryContexts } from './MemoryPlugin.js';

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
