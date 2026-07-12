export function getWorkbenchStorage(
  windowLike = typeof window === 'undefined' ? null : window,
) {
  try {
    return windowLike?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function normalizeWorkbenchPanelState(value, defaults) {
  const width = Number(value?.width);

  return {
    width: Number.isFinite(width)
      ? Math.max(defaults.minWidth, Math.min(defaults.maxWidth, width))
      : defaults.width,
    collapsed: Boolean(value?.collapsed),
  };
}

export function getWorkbenchPanelPresentation(panel, forceExpanded = false) {
  return forceExpanded && panel.collapsed
    ? { ...panel, collapsed: false }
    : panel;
}

export function loadWorkbenchPanelState(storage, key, defaults) {
  try {
    const value = storage?.getItem(key);
    return normalizeWorkbenchPanelState(value ? JSON.parse(value) : defaults, defaults);
  } catch {
    return normalizeWorkbenchPanelState(defaults, defaults);
  }
}

export function saveWorkbenchPanelState(storage, key, state, defaults) {
  const persisted = normalizeWorkbenchPanelState(state, defaults);

  try {
    storage?.setItem(key, JSON.stringify(persisted));
  } catch {
    // Browser storage can be unavailable or quota-limited; state remains usable.
  }

  return persisted;
}

export function toggleWorkbenchPanel(state) {
  return { ...state, collapsed: !state.collapsed };
}

export function enterWorkbenchFocus(panels) {
  return {
    panels: Object.fromEntries(
      Object.entries(panels).map(([key, panel]) => [key, { ...panel, collapsed: true }]),
    ),
    snapshot: Object.fromEntries(
      Object.entries(panels).map(([key, panel]) => [key, Boolean(panel.collapsed)]),
    ),
  };
}

export function restoreWorkbenchFocus(panels, focusSnapshot) {
  return Object.fromEntries(
    Object.entries(panels).map(([key, panel]) => [
      key,
      focusSnapshot && Object.hasOwn(focusSnapshot, key)
        ? { ...panel, collapsed: focusSnapshot[key] }
        : { ...panel },
    ]),
  );
}
