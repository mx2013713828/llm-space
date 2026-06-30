import test from 'node:test';
import assert from 'node:assert/strict';

import { apiUrl } from './apiClient.js';

test('apiUrl resolves paths against the default local API base', () => {
  assert.equal(apiUrl('/api/health'), 'http://localhost:3001/api/health');
  assert.equal(apiUrl('api/health'), 'http://localhost:3001/api/health');
});

test('apiUrl accepts an explicit base URL for tests and deployments', () => {
  assert.equal(
    apiUrl('/api/health', { baseUrl: 'https://llm-space.example.com/' }),
    'https://llm-space.example.com/api/health'
  );
});
