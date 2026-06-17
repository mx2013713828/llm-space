import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTEXT_WINDOW, formatTokenCount, getModelContextWindow } from './modelContext.js';

test('defaults context window to 128k when model has no metadata', () => {
  assert.equal(DEFAULT_CONTEXT_WINDOW, 128000);
  assert.deepEqual(getModelContextWindow({}), {
    value: 128000,
    estimated: true,
  });
});

test('defaults context window to 128k while selected model is still loading', () => {
  assert.deepEqual(getModelContextWindow(null), {
    value: 128000,
    estimated: true,
  });
});

test('uses explicit context window from model config', () => {
  assert.deepEqual(getModelContextWindow({ contextWindow: 256000 }), {
    value: 256000,
    estimated: false,
  });
});

test('formats token counts as compact k and M labels', () => {
  assert.equal(formatTokenCount(12000), '12k');
  assert.equal(formatTokenCount(128000), '128k');
  assert.equal(formatTokenCount(1000000), '1M');
  assert.equal(formatTokenCount(1250000), '1.25M');
  assert.equal(formatTokenCount(950), '950');
});
