import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createHarnessSummary,
  createCopiedHarnessDraft,
  createHarnessDraft,
  getHarnessStorageFilename,
  normalizeHarnessDisplayName,
  slugifyHarnessId,
} from './harnessIdentity.js';

test('normalizes display names independently from storage filenames', () => {
  assert.equal(normalizeHarnessDisplayName('My Bot.json'), 'My Bot');
  assert.equal(normalizeHarnessDisplayName('Basic Chatbot'), 'Basic Chatbot');
  assert.equal(getHarnessStorageFilename('my-bot'), 'my-bot.json');
  assert.deepEqual(createHarnessSummary({
    id: 'my-bot',
    name: 'My Bot.json',
    description: 'demo',
  }, 'legacy-file.json'), {
    id: 'my-bot',
    name: 'My Bot',
    filename: 'legacy-file.json',
    description: 'demo',
    category: 'basic',
  });
});

test('slugifyHarnessId creates storage-safe ids from display names', () => {
  assert.equal(slugifyHarnessId('My Research Bot'), 'my-research-bot');
  assert.equal(slugifyHarnessId('  中文 Bot !!  '), 'bot');
});

test('createHarnessDraft rejects duplicate ids even when filenames differ', () => {
  assert.throws(
    () => createHarnessDraft({
      name: 'My Bot',
      description: 'new',
      existingHarnesses: [{ id: 'my-bot', name: 'Different Filename.json' }],
    }),
    /Harness ID already exists/
  );
});

test('createHarnessDraft separates display name from storage filename', () => {
  const draft = createHarnessDraft({ name: 'My Bot', description: 'new' });
  assert.equal(draft.filename, 'my-bot.json');
  assert.equal(draft.harness.id, 'my-bot');
  assert.equal(draft.harness.name, 'My Bot');
});

test('createHarnessDraft rejects names that cannot produce a valid id', () => {
  assert.throws(
    () => createHarnessDraft({
      name: '中文',
      existingHarnesses: [],
    }),
    /valid Harness ID/
  );
});

test('createCopiedHarnessDraft chooses the next available copy id and filename', () => {
  const copy = createCopiedHarnessDraft({
    source: {
      id: 'demo',
      name: 'Demo.json',
      description: 'original',
      tools: ['read_file'],
    },
    existingHarnesses: [
      { id: 'demo', name: 'Demo.json' },
      { id: 'demo-copy', name: 'Demo-copy.json' },
    ],
  });

  assert.equal(copy.filename, 'demo-copy-2.json');
  assert.equal(copy.harness.id, 'demo-copy-2');
  assert.equal(copy.harness.name, 'Demo Copy 2');
  assert.equal(copy.harness.description, 'original (副本)');
  assert.deepEqual(copy.harness.tools, ['read_file']);
});
