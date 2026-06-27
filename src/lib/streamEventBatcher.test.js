import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamEventBatcher } from './streamEventBatcher.js';

test('batches many stream deltas into one scheduled flush', () => {
  const scheduled = [];
  const appliedBatches = [];
  const batcher = createStreamEventBatcher({
    schedule: callback => {
      scheduled.push(callback);
      return scheduled.length;
    },
    cancel: () => {},
    applyBatch: batch => appliedBatches.push(batch),
  });

  for (let i = 0; i < 100; i++) {
    batcher.enqueue({ type: 'text_delta', id: 'final_text', text: 'x' });
  }

  assert.equal(scheduled.length, 1);
  assert.equal(appliedBatches.length, 0);

  scheduled[0]();

  assert.equal(appliedBatches.length, 1);
  assert.equal(appliedBatches[0].length, 100);
});

test('flushNow applies pending stream deltas before terminal events', () => {
  const appliedBatches = [];
  const batcher = createStreamEventBatcher({
    schedule: () => 1,
    cancel: () => {},
    applyBatch: batch => appliedBatches.push(batch),
  });

  batcher.enqueue({ type: 'text_delta', id: 'final_text', text: 'partial' });
  batcher.flushNow();

  assert.deepEqual(appliedBatches, [[{ type: 'text_delta', id: 'final_text', text: 'partial' }]]);
});
