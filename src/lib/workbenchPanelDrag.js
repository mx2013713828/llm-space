const RESIZE_CLASS = 'workbench-is-resizing';

export function startWorkbenchPanelDrag({
  pointerId,
  handle,
  eventTarget,
  bodyClassList,
  initialPanel,
  getNextPanel,
  onChange,
  onCommit,
  onCleanup,
}) {
  let active = true;
  let panel = initialPanel;

  const cleanup = (commit) => {
    if (!active) return false;

    active = false;
    eventTarget.removeEventListener('pointermove', onPointerMove);
    eventTarget.removeEventListener('pointerup', onPointerUp);
    eventTarget.removeEventListener('pointercancel', onPointerCancel);
    bodyClassList.remove(RESIZE_CLASS);

    if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);

    onCleanup?.();
    if (commit) onCommit?.(panel);
    return true;
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== pointerId) return;

    panel = getNextPanel(panel, event.clientX);
    onChange?.(panel);
  };
  const onPointerUp = (event) => {
    if (event.pointerId === pointerId) cleanup(true);
  };
  const onPointerCancel = (event) => {
    if (event.pointerId === pointerId) cleanup(false);
  };

  handle.setPointerCapture(pointerId);
  bodyClassList.add(RESIZE_CLASS);
  eventTarget.addEventListener('pointermove', onPointerMove);
  eventTarget.addEventListener('pointerup', onPointerUp);
  eventTarget.addEventListener('pointercancel', onPointerCancel);

  return { cleanup };
}
