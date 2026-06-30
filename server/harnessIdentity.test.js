import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createCopiedHarnessDraft,
  createHarnessDraft,
  slugifyHarnessId,
} from './harnessIdentity.js';

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

  assert.equal(copy.id, 'demo-copy-2');
  assert.equal(copy.name, 'Demo-copy-2.json');
  assert.equal(copy.description, 'original (副本)');
  assert.deepEqual(copy.tools, ['read_file']);
});
