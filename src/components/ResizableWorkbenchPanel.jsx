import { useCallback, useEffect, useRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { normalizeWorkbenchPanelState, toggleWorkbenchPanel } from '../lib/workbenchPanelState.js';

const COLLAPSED_PANEL_WIDTH = 42;

export function ResizableWorkbenchPanel({
  id,
  label,
  icon,
  panel,
  minWidth,
  maxWidth,
  onPanelChange,
  onPanelCommit,
  children,
}) {
  const dragRef = useRef(null);
  const onPanelChangeRef = useRef(onPanelChange);
  const onPanelCommitRef = useRef(onPanelCommit);

  useEffect(() => {
    onPanelChangeRef.current = onPanelChange;
    onPanelCommitRef.current = onPanelCommit;
  }, [onPanelChange, onPanelCommit]);

  const cleanUpDrag = useCallback((commit) => {
    const drag = dragRef.current;
    if (!drag) return;

    document.removeEventListener('pointermove', drag.onPointerMove);
    document.removeEventListener('pointerup', drag.onPointerEnd);
    document.removeEventListener('pointercancel', drag.onPointerEnd);
    document.body.classList.remove('workbench-is-resizing');

    if (drag.handle.hasPointerCapture?.(drag.pointerId)) {
      drag.handle.releasePointerCapture(drag.pointerId);
    }

    dragRef.current = null;
    if (commit) onPanelCommitRef.current?.(drag.panel);
  }, []);

  useEffect(() => () => cleanUpDrag(false), [cleanUpDrag]);

  const updateCollapsed = () => {
    const nextPanel = toggleWorkbenchPanel(panel);
    onPanelChangeRef.current?.(nextPanel);
    onPanelCommitRef.current?.(nextPanel);
  };

  const beginResize = (event) => {
    if (event.button !== 0 || dragRef.current) return;

    event.preventDefault();
    const handle = event.currentTarget;
    const panelElement = handle.closest('.workbench-panel');
    if (!panelElement) return;

    const normalizePanel = (value) => normalizeWorkbenchPanelState(value, {
      width: panel.width,
      minWidth,
      maxWidth,
      collapsed: panel.collapsed,
    });
    const drag = {
      handle,
      panel: normalizePanel(panel),
      pointerId: event.pointerId,
      startLeft: panelElement.getBoundingClientRect().left,
      onPointerMove: null,
      onPointerEnd: null,
    };

    drag.onPointerMove = (moveEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      const nextPanel = normalizePanel({
        ...drag.panel,
        width: moveEvent.clientX - drag.startLeft,
        collapsed: false,
      });
      drag.panel = nextPanel;
      onPanelChangeRef.current?.(nextPanel);
    };
    drag.onPointerEnd = (endEvent) => {
      if (endEvent.pointerId === drag.pointerId) cleanUpDrag(true);
    };

    dragRef.current = drag;
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add('workbench-is-resizing');
    document.addEventListener('pointermove', drag.onPointerMove);
    document.addEventListener('pointerup', drag.onPointerEnd);
    document.addEventListener('pointercancel', drag.onPointerEnd);
  };

  const panelTitle = `${label} panel`;

  return (
    <aside
      aria-label={panelTitle}
      className="workbench-panel"
      id={id}
      style={{ width: panel.collapsed ? COLLAPSED_PANEL_WIDTH : panel.width }}
    >
      {panel.collapsed ? (
        <div className="workbench-panel-rail">
          <button
            aria-label={`Expand ${label}`}
            className="workbench-panel-toggle"
            title={`Expand ${label}`}
            type="button"
            onClick={updateCollapsed}
          >
            <PanelLeftOpen size={17} />
          </button>
        </div>
      ) : (
        <>
          <div className="workbench-panel-header">
            <span className="workbench-panel-label">{icon}{label}</span>
            <button
              aria-label={`Collapse ${label}`}
              className="workbench-panel-toggle"
              title={`Collapse ${label}`}
              type="button"
              onClick={updateCollapsed}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          <div className="workbench-panel-content">{children}</div>
          <div
            aria-label={`Resize ${label}`}
            className="workbench-resize-handle"
            role="separator"
            aria-orientation="vertical"
            onPointerDown={beginResize}
          />
        </>
      )}
    </aside>
  );
}
