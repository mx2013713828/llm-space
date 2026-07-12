import { useEffect, useRef } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { startWorkbenchPanelDrag } from '../lib/workbenchPanelDrag.js';
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

  useEffect(() => () => {
    dragRef.current?.cleanup(false);
    dragRef.current = null;
  }, []);

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
    const startLeft = panelElement.getBoundingClientRect().left;
    const drag = startWorkbenchPanelDrag({
      pointerId: event.pointerId,
      handle,
      eventTarget: document,
      bodyClassList: document.body.classList,
      initialPanel: normalizePanel(panel),
      getNextPanel: (currentPanel, clientX) => normalizePanel({
        ...currentPanel,
        width: clientX - startLeft,
        collapsed: false,
      }),
      onChange: (nextPanel) => onPanelChangeRef.current?.(nextPanel),
      onCommit: (nextPanel) => onPanelCommitRef.current?.(nextPanel),
      onCleanup: () => {
        dragRef.current = null;
      },
    });

    dragRef.current = drag;
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
          <span aria-hidden="true" className="workbench-panel-rail-icon" title={label}>{icon}</span>
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
