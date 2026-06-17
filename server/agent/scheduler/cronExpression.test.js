import test from 'node:test';
import assert from 'node:assert/strict';
import { cronMatches, validateCron } from './cronExpression.js';

test('matches every five minutes', () => {
  assert.equal(cronMatches('*/5 * * * *', new Date('2026-06-17T09:10:00+08:00')), true);
  assert.equal(cronMatches('*/5 * * * *', new Date('2026-06-17T09:11:00+08:00')), false);
});

test('uses cron DOM and DOW OR semantics when both are constrained', () => {
  assert.equal(cronMatches('0 9 17 * 1', new Date('2026-06-17T09:00:00+08:00')), true);
});

test('rejects invalid cron expressions', () => {
  assert.match(validateCron('* * *'), /five fields/i);
  assert.match(validateCron('61 * * * *'), /minute/i);
  assert.equal(validateCron('0 9 * * 1-5'), null);
});
