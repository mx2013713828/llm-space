import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enterWorkbenchFocus,
  loadWorkbenchPanelState,
  normalizeWorkbenchPanelState,
  restoreWorkbenchFocus,
  saveWorkbenchPanelState,
  toggleWorkbenchPanel,
} from './workbenchPanelState.js';

const defaults = {
  width: 340,
  minWidth: 280,
  maxWidth: 480,
  collapsed: false,
};

test('normalizes invalid widths and preserves collapsed state', () => {
  assert.deepEqual(
    normalizeWorkbenchPanelState({ width: 999, collapsed: true }, defaults),
    { width: 480, collapsed: true },
  );
});

test('normalizes missing and non-numeric widths to the default width', () => {
  assert.deepEqual(normalizeWorkbenchPanelState({ width: 'not a width' }, defaults), {
    width: defaults.width,
    collapsed: false,
  });
});

test('loads malformed browser storage as defaults', () => {
  const storage = {
    getItem() {
      return '{malformed';
    },
  };

  assert.deepEqual(loadWorkbenchPanelState(storage, 'panel', defaults), {
    width: defaults.width,
    collapsed: defaults.collapsed,
  });
});

test('loads and normalizes a persisted panel state', () => {
  const storage = {
    getItem() {
      return JSON.stringify({ width: 100, collapsed: 1, ignored: true });
    },
  };

  assert.deepEqual(loadWorkbenchPanelState(storage, 'panel', defaults), {
    width: defaults.minWidth,
    collapsed: true,
  });
});

test('saves only normalized panel values and returns them when storage is unavailable', () => {
  const writes = [];
  const storage = {
    setItem(key, value) {
      writes.push([key, value]);
    },
  };
  const expected = { width: defaults.maxWidth, collapsed: true };

  assert.deepEqual(saveWorkbenchPanelState(storage, 'panel', { width: 999, collapsed: true, extra: 'ignored' }, defaults), expected);
  assert.deepEqual(writes, [['panel', JSON.stringify(expected)]]);

  assert.deepEqual(saveWorkbenchPanelState(null, 'panel', { width: 300 }, defaults), {
    width: 300,
    collapsed: false,
  });
});

test('toggles a panel without mutating its state', () => {
  const state = { width: 300, collapsed: false };

  assert.deepEqual(toggleWorkbenchPanel(state), { width: 300, collapsed: true });
  assert.deepEqual(state, { width: 300, collapsed: false });
});

test('focus snapshots restore only panels collapsed by focus mode', () => {
  const explorer = { width: 272, collapsed: false };
  const config = { width: 340, collapsed: true };
  const focused = enterWorkbenchFocus({ explorer, config });

  assert.equal(focused.panels.explorer.collapsed, true);
  assert.equal(restoreWorkbenchFocus(focused.panels, focused.snapshot).explorer.collapsed, false);
  assert.equal(restoreWorkbenchFocus(focused.panels, focused.snapshot).config.collapsed, true);
});

test('focus mode preserves panel values while changing collapse state', () => {
  const panels = { explorer: { width: 272, collapsed: false } };
  const focused = enterWorkbenchFocus(panels);

  assert.deepEqual(focused.panels, { explorer: { width: 272, collapsed: true } });
  assert.deepEqual(focused.snapshot, { explorer: false });
  assert.deepEqual(panels, { explorer: { width: 272, collapsed: false } });
});
