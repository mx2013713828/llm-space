import test from 'node:test';
import assert from 'node:assert/strict';

import {
  closeHarnessDialog,
  createHarnessExplorerState,
  getHarnessCountLabel,
  openHarnessDelete,
  openHarnessDialog,
  previewHarnessId,
} from './harnessExplorerState.js';

const harness = {
  id: 'research-lab',
  name: 'Research Lab',
  description: 'Long-running experiments',
};

test('opens a blank create dialog with a generated id preview', () => {
  const state = openHarnessDialog(createHarnessExplorerState(), 'create');
  assert.deepEqual(state.dialog, {
    mode: 'create',
    sourceId: '',
    draft: { name: '', description: '' },
  });
  assert.equal(previewHarnessId('New Research Harness'), 'new-research-harness');
});

test('opens edit and duplicate dialogs with focused metadata drafts', () => {
  const initial = createHarnessExplorerState();
  const editState = openHarnessDialog(initial, 'edit', harness);
  assert.deepEqual(editState.dialog, {
    mode: 'edit',
    sourceId: 'research-lab',
    draft: { name: 'Research Lab', description: 'Long-running experiments' },
  });

  const duplicateState = openHarnessDialog(initial, 'duplicate', harness);
  assert.deepEqual(duplicateState.dialog, {
    mode: 'duplicate',
    sourceId: 'research-lab',
    draft: { name: 'Research Lab Copy', description: 'Long-running experiments' },
  });
});

test('opens delete confirmation and closes dialogs without stale errors', () => {
  const initial = {
    ...createHarnessExplorerState(),
    error: 'Old error',
    menu: { harnessId: 'research-lab', x: 10, y: 20 },
  };
  const deleteState = openHarnessDelete(initial, harness);
  assert.deepEqual(deleteState.dialog, {
    mode: 'delete',
    sourceId: 'research-lab',
    draft: { name: 'Research Lab', description: 'Long-running experiments' },
  });
  assert.equal(deleteState.error, '');
  assert.equal(deleteState.menu, null);

  assert.deepEqual(closeHarnessDialog({ ...deleteState, error: 'Failed' }), {
    dialog: null,
    menu: null,
    error: '',
  });
});

test('formats singular and plural harness counts', () => {
  assert.equal(getHarnessCountLabel(0), '0 harnesses');
  assert.equal(getHarnessCountLabel(1), '1 harness');
  assert.equal(getHarnessCountLabel(12), '12 harnesses');
});
