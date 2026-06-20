import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRunDuration, getRunStatusLabel } from './cronRunPresentation.js';

test('formats scheduled run durations for scanning', () => {
  assert.equal(formatRunDuration(null), 'In progress');
  assert.equal(formatRunDuration(420), '420 ms');
  assert.equal(formatRunDuration(2500), '2.5 s');
  assert.equal(formatRunDuration(65400), '1m 5s');
});

test('labels persisted run states', () => {
  assert.equal(getRunStatusLabel('succeeded'), 'Succeeded');
  assert.equal(getRunStatusLabel('interrupted'), 'Interrupted');
  assert.equal(getRunStatusLabel('other'), 'Unknown');
});
