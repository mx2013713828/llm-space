import test from 'node:test';
import assert from 'node:assert/strict';

import { startWorkbenchPanelDrag } from './workbenchPanelDrag.js';

function createEventTarget() {
  const listeners = new Map();
  const addCalls = [];
  const removeCalls = [];

  return {
    addCalls,
    removeCalls,
    addEventListener(type, listener) {
      addCalls.push([type, listener]);
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      removeCalls.push([type, listener]);
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    },
  };
}

function createHandle() {
  const captured = new Set();
  const released = [];

  return {
    released,
    setPointerCapture(pointerId) {
      captured.add(pointerId);
    },
    hasPointerCapture(pointerId) {
      return captured.has(pointerId);
    },
    releasePointerCapture(pointerId) {
      released.push(pointerId);
      captured.delete(pointerId);
    },
  };
}

function createClassList() {
  const classes = new Set();
  return {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    has(name) { return classes.has(name); },
  };
}

test('installs drag listeners only while active and commits once on matching pointer up', () => {
  const target = createEventTarget();
  const handle = createHandle();
  const bodyClassList = createClassList();
  const changes = [];
  const commits = [];
  const drag = startWorkbenchPanelDrag({
    pointerId: 7,
    handle,
    eventTarget: target,
    bodyClassList,
    initialPanel: { width: 300, collapsed: false },
    getNextPanel: (panel, clientX) => ({ ...panel, width: clientX }),
    onChange: (panel) => changes.push(panel),
    onCommit: (panel) => commits.push(panel),
  });

  assert.deepEqual(target.addCalls.map(([type]) => type), ['pointermove', 'pointerup', 'pointercancel']);
  assert.equal(bodyClassList.has('workbench-is-resizing'), true);

  target.dispatch('pointermove', { pointerId: 8, clientX: 100 });
  target.dispatch('pointermove', { pointerId: 7, clientX: 360 });
  target.dispatch('pointermove', { pointerId: 7, clientX: 380 });
  assert.deepEqual(changes, [
    { width: 360, collapsed: false },
    { width: 380, collapsed: false },
  ]);

  target.dispatch('pointerup', { pointerId: 8 });
  assert.deepEqual(commits, []);
  target.dispatch('pointerup', { pointerId: 7 });
  target.dispatch('pointerup', { pointerId: 7 });

  assert.deepEqual(commits, [{ width: 380, collapsed: false }]);
  assert.deepEqual(target.removeCalls.map(([type]) => type), ['pointermove', 'pointerup', 'pointercancel']);
  assert.equal(bodyClassList.has('workbench-is-resizing'), false);
  assert.deepEqual(handle.released, [7]);
  assert.equal(drag.cleanup(false), false);
});

test('cancels and unmount cleanup remove drag state without committing', () => {
  for (const finish of ['pointercancel', 'cleanup']) {
    const target = createEventTarget();
    const handle = createHandle();
    const bodyClassList = createClassList();
    const commits = [];
    const drag = startWorkbenchPanelDrag({
      pointerId: 4,
      handle,
      eventTarget: target,
      bodyClassList,
      initialPanel: { width: 300, collapsed: false },
      getNextPanel: (panel) => panel,
      onChange: () => {},
      onCommit: (panel) => commits.push(panel),
    });

    if (finish === 'pointercancel') target.dispatch('pointercancel', { pointerId: 4 });
    else drag.cleanup(false);

    assert.deepEqual(commits, []);
    assert.deepEqual(target.removeCalls.map(([type]) => type), ['pointermove', 'pointerup', 'pointercancel']);
    assert.equal(bodyClassList.has('workbench-is-resizing'), false);
    assert.deepEqual(handle.released, [4]);
  }
});
