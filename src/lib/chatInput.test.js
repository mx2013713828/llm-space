import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSubmitMessage } from './chatInput.js';

test('submits on plain Enter', () => {
  assert.equal(shouldSubmitMessage({ key: 'Enter', shiftKey: false }, false), true);
});

test('does not submit on Shift Enter', () => {
  assert.equal(shouldSubmitMessage({ key: 'Enter', shiftKey: true }, false), false);
});

test('does not submit while IME composition is active', () => {
  assert.equal(shouldSubmitMessage({ key: 'Enter', shiftKey: false }, true), false);
});

test('does not submit when native composition flag is active', () => {
  assert.equal(shouldSubmitMessage({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true } }, false), false);
});

test('does not submit on keyCode 229 IME event', () => {
  assert.equal(shouldSubmitMessage({ key: 'Enter', shiftKey: false, keyCode: 229 }, false), false);
});
