import test from 'node:test';
import assert from 'node:assert/strict';

import { handleLegacyChatRoute } from './legacyChatRoute.js';

function createJsonResponse() {
  return {
    statusCode: null,
    body: null,
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

test('legacy chat route returns 410 without proxying model traffic', () => {
  const res = createJsonResponse();

  handleLegacyChatRoute({}, res);

  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.body, {
    error: 'Legacy /api/chat is disabled. Use /api/agent/run instead.',
  });
});
