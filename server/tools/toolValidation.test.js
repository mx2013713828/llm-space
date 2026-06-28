import test from 'node:test';
import assert from 'node:assert/strict';

import readFile from './read_file.js';
import { validateToolInput } from './toolValidation.js';

test('rejects missing required string parameters', () => {
  assert.deepEqual(validateToolInput(readFile, {}), {
    ok: false,
    code: 'missing_required_parameter',
    message: 'read_file requires parameter "path".',
    details: { parameter: 'path', expectedType: 'string' },
  });
});

test('rejects invalid primitive parameter types', () => {
  assert.deepEqual(validateToolInput(readFile, { path: 42 }), {
    ok: false,
    code: 'invalid_parameter_type',
    message: 'read_file parameter "path" must be string.',
    details: { parameter: 'path', expectedType: 'string', actualType: 'number' },
  });
});

test('accepts valid required parameters', () => {
  assert.deepEqual(validateToolInput(readFile, { path: 'server.js' }), { ok: true });
});
