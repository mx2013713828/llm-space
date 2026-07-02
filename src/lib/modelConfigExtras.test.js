import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatExtraBodyForEditor,
  sanitizeModelConfigForSave,
  updateExtraBodyDraft,
} from './modelConfigExtras.js';

test('formatExtraBodyForEditor formats saved extraBody as pretty JSON', () => {
  assert.equal(
    formatExtraBodyForEditor({ extraBody: { enable_thinking: true } }),
    '{\n  "enable_thinking": true\n}'
  );
});

test('updateExtraBodyDraft stores valid object JSON and rejects invalid JSON', () => {
  const valid = updateExtraBodyDraft({}, '{ "enable_thinking": true }');
  assert.deepEqual(valid.extraBody, { enable_thinking: true });
  assert.equal(valid._extraBodyError, undefined);

  const invalid = updateExtraBodyDraft(valid, '{ nope');
  assert.equal(invalid._extraBodyError, 'Extra Body must be valid JSON.');
  assert.deepEqual(invalid.extraBody, { enable_thinking: true });
});

test('sanitizeModelConfigForSave removes editor-only extraBody fields', () => {
  assert.deepEqual(
    sanitizeModelConfigForSave({
      name: 'Kimi',
      extraBody: { enable_thinking: true },
      _extraBodyText: '{ "enable_thinking": true }',
      _extraBodyError: '',
    }),
    {
      name: 'Kimi',
      extraBody: { enable_thinking: true },
    }
  );
});
