import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccessGuard,
  createRateLimiter,
  isLocalRequest,
  normalizeRemoteAddress,
} from './accessGuard.js';

function createRequest({
  ip,
  remoteAddress,
  method = 'GET',
  path = '/api/agent/run',
  headers = {},
} = {}) {
  return {
    ip,
    method,
    path,
    originalUrl: path,
    headers,
    socket: { remoteAddress },
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function dispatch(middleware, req) {
  const res = createResponse();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

test('normalizeRemoteAddress handles IPv4-mapped localhost', () => {
  assert.equal(normalizeRemoteAddress('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeRemoteAddress(' ::1 '), '::1');
});

test('isLocalRequest accepts localhost addresses', () => {
  assert.equal(isLocalRequest(createRequest({ remoteAddress: '127.0.0.1' })), true);
  assert.equal(isLocalRequest(createRequest({ remoteAddress: '::1' })), true);
  assert.equal(isLocalRequest(createRequest({ ip: '::ffff:127.0.0.1' })), true);
});

test('access guard allows local requests without a token', async () => {
  const guard = createAccessGuard({ token: '' });
  const result = await dispatch(guard, createRequest({ remoteAddress: '127.0.0.1' }));

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, 200);
});

test('access guard rejects non-local requests when no token is configured', async () => {
  const guard = createAccessGuard({ token: '' });
  const result = await dispatch(guard, createRequest({ remoteAddress: '192.168.1.20' }));

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
  assert.match(result.res.body.error, /local runtime API/i);
});

test('access guard allows non-local requests with a valid configured token', async () => {
  const guard = createAccessGuard({ token: 'secret-token' });
  const result = await dispatch(guard, createRequest({
    remoteAddress: '192.168.1.20',
    headers: { 'x-llm-space-token': 'secret-token' },
  }));

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, 200);
});

test('access guard accepts bearer authorization token', async () => {
  const guard = createAccessGuard({ token: 'secret-token' });
  const result = await dispatch(guard, createRequest({
    remoteAddress: '10.0.0.8',
    headers: { authorization: 'Bearer secret-token' },
  }));

  assert.equal(result.nextCalled, true);
  assert.equal(result.res.statusCode, 200);
});

test('access guard rejects invalid token', async () => {
  const guard = createAccessGuard({ token: 'secret-token' });
  const result = await dispatch(guard, createRequest({
    remoteAddress: '10.0.0.8',
    headers: { 'x-llm-space-token': 'wrong' },
  }));

  assert.equal(result.nextCalled, false);
  assert.equal(result.res.statusCode, 403);
});

test('rate limiter limits configured paths by remote address', async () => {
  let now = 1000;
  const limiter = createRateLimiter({
    windowMs: 1000,
    max: 2,
    now: () => now,
    paths: ['/api/agent/run'],
  });

  const first = await dispatch(limiter, createRequest({ remoteAddress: '127.0.0.1' }));
  const second = await dispatch(limiter, createRequest({ remoteAddress: '127.0.0.1' }));
  const third = await dispatch(limiter, createRequest({ remoteAddress: '127.0.0.1' }));

  assert.equal(first.nextCalled, true);
  assert.equal(second.nextCalled, true);
  assert.equal(third.nextCalled, false);
  assert.equal(third.res.statusCode, 429);
  assert.equal(third.res.headers['Retry-After'], '1');

  now = 2200;
  const afterWindow = await dispatch(limiter, createRequest({ remoteAddress: '127.0.0.1' }));
  assert.equal(afterWindow.nextCalled, true);
});

test('rate limiter bypasses unconfigured paths and preflight requests', async () => {
  const limiter = createRateLimiter({
    windowMs: 1000,
    max: 0,
    paths: ['/api/agent/run'],
  });

  const unconfigured = await dispatch(limiter, createRequest({
    remoteAddress: '127.0.0.1',
    path: '/api/agent/status',
  }));
  const preflight = await dispatch(limiter, createRequest({
    remoteAddress: '127.0.0.1',
    method: 'OPTIONS',
  }));

  assert.equal(unconfigured.nextCalled, true);
  assert.equal(preflight.nextCalled, true);
});
