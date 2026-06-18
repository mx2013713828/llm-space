import test from 'node:test';
import assert from 'node:assert/strict';
import { getUserMessagePresentation } from './messagePresentation.js';

test('classifies scheduled user messages and removes the transport prefix', () => {
  assert.deepEqual(getUserMessagePresentation({
    role: 'user',
    type: 'scheduled',
    content: '[Scheduled] check build'
  }), {
    variant: 'scheduled',
    content: 'check build'
  });
});

test('keeps normal user messages unchanged', () => {
  assert.deepEqual(getUserMessagePresentation({
    role: 'user',
    type: 'text',
    content: 'hello'
  }), {
    variant: 'user',
    content: 'hello'
  });
});
