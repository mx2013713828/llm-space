export function createHarnessExplorerState() {
  return {
    dialog: null,
    menu: null,
    error: '',
  };
}

function createHarnessDraft(mode, harness = {}) {
  if (mode === 'create') {
    return { name: '', description: '' };
  }

  const name = String(harness.name || harness.id || '');
  return {
    name: mode === 'duplicate' ? `${name} Copy` : name,
    description: String(harness.description || ''),
  };
}

export function openHarnessDialog(state, mode, harness = {}) {
  return {
    ...state,
    dialog: {
      mode,
      sourceId: mode === 'create' ? '' : String(harness.id || ''),
      draft: createHarnessDraft(mode, harness),
    },
    menu: null,
    error: '',
  };
}

export function openHarnessDelete(state, harness) {
  return openHarnessDialog(state, 'delete', harness);
}

export function closeHarnessDialog() {
  return createHarnessExplorerState();
}

export function previewHarnessId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getHarnessCountLabel(count) {
  const safeCount = Number.isFinite(Number(count)) ? Number(count) : 0;
  return `${safeCount} harness${safeCount === 1 ? '' : 'es'}`;
}
