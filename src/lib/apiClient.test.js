import test from 'node:test';
import assert from 'node:assert/strict';

import { apiFetch, apiUrl } from './apiClient.js';

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

test('apiFetch can attach a configured local API token', async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true };
  };

  await apiFetch('/api/models', {
    baseUrl: 'http://127.0.0.1:3001',
    apiToken: 'dev-token',
    headers: { accept: 'application/json' },
  }, fetchImpl);

  assert.equal(capturedUrl, 'http://127.0.0.1:3001/api/models');
  assert.equal(capturedOptions.headers.get('accept'), 'application/json');
  assert.equal(capturedOptions.headers.get('x-llm-space-token'), 'dev-token');
  assert.equal('apiToken' in capturedOptions, false);
  assert.equal('baseUrl' in capturedOptions, false);
});
