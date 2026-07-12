# Resizable Workbench Panels Design

## Implementation Status

Automated implementation for the resizable workbench panels is complete. The production build and whitespace check pass; the full test suite has one unrelated failure in `server/agent/taskOrchestrationHarnesses.test.js` (`02-bash.json: raw enabled`). The manual desktop acceptance checklist remains pending because host-local browser automation is unavailable in the verification environment. No production interface changes are required for this documentation closeout.

## Goal

Give the Trajectory workspace more room by making its two left-side panels independently resizable and collapsible:

- the application-level Harness Explorer;
- the Trajectory-only runtime configuration panel.

The result should behave like a developer workbench: persistent personal layout, direct manipulation, and a fast focus mode without adding a second configuration surface.

## Scope

- Drag each panel's right divider to change its width.
- Collapse or restore each panel independently.
- Persist widths and collapsed state in browser `localStorage`.
- Keep a thin, icon-only rail visible while a panel is collapsed.
- Add a one-click Trajectory focus control that temporarily collapses both panels, while preserving each panel's saved width.
- Keep the existing Harness Explorer and ConfigPanel responsibilities unchanged.

Out of scope:

- Mobile layout redesign.
- Per-Harness layout settings.
- Reordering panels or moving configuration to a new page.
- Altering Harness, model, Knowledge, or Agent execution behavior.

## Layout Model

The two panels remain separate ownership boundaries:

| Panel | Owner | Default width | Drag range | Collapsed rail |
| --- | --- | ---: | ---: | ---: |
| Harness Explorer | `App.jsx` | 272px | 216px–420px | 42px |
| Runtime Configuration | `TrajectoryPage.jsx` | 340px | 280px–480px | 42px |

The remaining width belongs to the trajectory. While dragging, the page disables text selection and uses the appropriate resize cursor. Width writes are applied live with CSS custom properties or inline style, and are persisted only after the pointer is released to avoid storage churn.

At viewport widths below the existing narrow-screen breakpoint, the current responsive behavior remains authoritative: the desktop panels are hidden rather than exposing the new rails.

## Interaction

### Panel controls

Each visible panel header includes one icon-only collapse button. Its tooltip and accessible label describe the action. When collapsed, the rail shows:

- an identifying icon;
- an expand button;
- a tooltip naming the panel.

The divider is keyboard-neutral visual chrome rather than a fake button; mouse/pointer dragging is the supported resizing mechanism in this desktop workbench.

### Focus mode

The Trajectory toolbar gains an icon-only `Focus trajectory` action. It:

1. stores which panels were expanded;
2. collapses both left panels;
3. changes to `Restore workspace`;
4. restores exactly the panels that it collapsed when pressed again.

Manual panel changes while focus mode is active exit focus mode. Focus mode never overwrites saved widths.

### Persistence

Browser-local layout preferences use explicit versioned keys:

```text
llm-space.workbench.harness-explorer.v1
llm-space.workbench.trajectory-config.v1
```

Each record stores `{ width, collapsed }`. Invalid, stale, or unavailable storage falls back silently to defaults. This is deliberately local UI preference, not Harness configuration, so it is not written to the Harness JSON or sent to the server.

## Component Architecture

Introduce a small reusable layout primitive and pure storage helpers:

```text
src/lib/workbenchPanelState.js
  - normalizeWorkbenchPanelState()
  - loadWorkbenchPanelState()
  - saveWorkbenchPanelState()

src/components/ResizableWorkbenchPanel.jsx
  - expanded panel wrapper + drag divider
  - collapsed rail
  - pointer lifecycle and accessible controls
```

`App.jsx` owns the Harness Explorer panel state. `TrajectoryPage.jsx` owns its configuration panel state and passes focus actions into `TrajectoryView`. The shared component receives fixed identity, bounds, a state object, and update callbacks; it never knows about Harnesses or agent configuration.

`WorkbenchLayoutContext` is the narrow coordination bridge for focus mode. `App.jsx` provides only the Explorer panel state, its setter, and focus snapshot operations. `TrajectoryPage.jsx` continues to own configuration state, reads the Explorer controls through the context, and performs the two-panel focus/restore transition. This avoids global browser events and keeps the two layout records independent.

## Error Handling And Performance

- Local storage read/write failures do not block rendering.
- Pointer listeners are attached only during an active drag and removed on pointer up/cancel or unmount.
- Width is clamped on every update and again during persistence.
- The components do not re-mount the agent loop, trajectory messages, or configuration form while resizing.
- Focus restoration is resilient when a user manually expands or collapses a panel.

## Testing

- Pure state tests cover defaulting, clamping, malformed local storage, persistence, and collapse toggles.
- Component-facing helpers cover focus-mode restore semantics.
- Build verifies the React integration.
- Manual desktop verification covers resize limits, both collapsed rails, refresh persistence, focus/restore, long trajectories, and switching Harnesses.

## Acceptance Criteria

1. Both left panels can be resized independently on desktop.
2. Both panels can be collapsed and restored independently.
3. Collapsed panels retain a discoverable 42px rail.
4. Width and collapsed state survive refresh and Harness switching.
5. Focus trajectory collapses both panels and restores their previous expanded state.
6. The trajectory expands immediately when either panel is collapsed or narrowed.
7. No agent runtime state, Harness config, or messages are reset while changing layout.
