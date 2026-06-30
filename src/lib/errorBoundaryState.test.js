import test from 'node:test';
import assert from 'node:assert/strict';

import { createErrorBoundaryState } from './errorBoundaryState.js';

test('createErrorBoundaryState extracts a readable error message', () => {
  assert.deepEqual(createErrorBoundaryState(new Error('boom')), {
    hasError: true,
    message: 'boom',
  });
});

test('createErrorBoundaryState falls back for unknown thrown values', () => {
  assert.deepEqual(createErrorBoundaryState(null), {
    hasError: true,
    message: 'Unknown UI error',
  });
});
