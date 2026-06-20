import test from 'node:test';
import assert from 'node:assert/strict';

import getCurrentTime, { buildCurrentTime } from './get_current_time.js';

test('builds timezone-aware current time details for one instant', () => {
  const result = buildCurrentTime({
    now: new Date('2026-06-20T06:30:45.000Z'),
    timeZone: 'Asia/Shanghai',
  });

  assert.deepEqual(result, {
    date: '2026-06-20',
    time: '14:30:45',
    timezone: 'Asia/Shanghai',
    iso: '2026-06-20T06:30:45.000Z',
  });
});

test('exposes a parameterless tool that returns parseable JSON', async () => {
  assert.equal(getCurrentTime.name, 'get_current_time');
  assert.deepEqual(getCurrentTime.parameters, {});

  const output = await getCurrentTime.execute();
  const parsed = JSON.parse(output);

  assert.deepEqual(Object.keys(parsed), ['date', 'time', 'timezone', 'iso']);
});
