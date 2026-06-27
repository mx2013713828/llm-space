export function createStreamEventBatcher({
  schedule,
  cancel,
  applyBatch,
}) {
  let pending = [];
  let scheduledHandle = null;

  const flushNow = () => {
    if (scheduledHandle !== null) {
      cancel(scheduledHandle);
      scheduledHandle = null;
    }
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    applyBatch(batch);
  };

  const enqueue = (event) => {
    pending.push(event);
    if (scheduledHandle !== null) return;
    scheduledHandle = schedule(() => {
      scheduledHandle = null;
      flushNow();
    });
  };

  const dispose = () => {
    if (scheduledHandle !== null) {
      cancel(scheduledHandle);
      scheduledHandle = null;
    }
    pending = [];
  };

  return {
    enqueue,
    flushNow,
    dispose,
  };
}
