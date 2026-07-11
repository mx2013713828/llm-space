import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMcpHttpHeaders, buildMcpStdioEnvironment } from './mcpClient.js';

test('lets configured STDIO environment values override inherited values', () => {
	const env = buildMcpStdioEnvironment({
		env: { CONTEXT7_API_KEY: 'from-studio' },
	}, { CONTEXT7_API_KEY: 'from-shell', PATH: '/bin' });

	assert.equal(env.CONTEXT7_API_KEY, 'from-studio');
	assert.equal(env.PATH, '/bin');
});

test('builds generic HTTP headers without a special auth mode', () => {
	const headers = buildMcpHttpHeaders({
		headers: {
			'X-API-Key': 'local-key',
			Authorization: 'Custom authorization',
		},
	}, {});

	assert.equal(headers['X-API-Key'], 'local-key');
	assert.equal(headers.Authorization, 'Custom authorization');
	assert.equal(headers['content-type'], 'application/json');
});

test('uses legacy bearer env only when no explicit authorization header exists', () => {
	const legacyHeaders = buildMcpHttpHeaders({
		auth: { type: 'bearer', env: 'LEGACY_TOKEN' },
	}, { LEGACY_TOKEN: 'shell-token' });
	assert.equal(legacyHeaders.Authorization, 'Bearer shell-token');

	const explicitHeaders = buildMcpHttpHeaders({
		headers: { authorization: 'Explicit value' },
		auth: { type: 'bearer', env: 'LEGACY_TOKEN' },
	}, { LEGACY_TOKEN: 'shell-token' });
	assert.equal(explicitHeaders.authorization, 'Explicit value');
	assert.equal(explicitHeaders.Authorization, undefined);
});
