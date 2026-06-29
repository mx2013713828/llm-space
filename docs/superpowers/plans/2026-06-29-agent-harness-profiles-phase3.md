# Agent Harness Profiles Phase 3 Plan

## Goal

Unify the user-facing presentation of child agents across `sub_agent` and `agent_teams`, with special focus on permission waits, status badges, and lazy trace loading. This phase should reduce duplicated UI logic while preserving the runtime split between inline sub-agents and asynchronous teammates.

## Scope

Phase 3 implements:

1. A shared frontend child-agent status presentation model.
2. `awaiting_permission` propagation from child runtime events to sub-agent and teammate cards.
3. Shared status rendering for sub-agent and teammate cards.
4. Shared trace-reference normalization for sub-agent and teammate lazy loading.
5. Documentation status updates and verification.

Phase 3 does not implement real child-agent cancellation. Cancellation requires a runtime abort contract that can stop child executors and in-flight tool approvals safely. This phase will keep `cancelled` as a presentation state, but will not expose a fake cancel button.

## Implementation Tasks

### 1. Shared Child Status Presentation

- Add a frontend helper that normalizes child status from either `status` or `state`.
- Cover `running`, `awaiting_permission`, `completed`, `failed`, `no_result`, `turn_limit`, and `cancelled`.
- Return badge label, tone, terminal/waiting flags, and display action text.
- Add focused unit tests before implementation.

### 2. Permission Wait Propagation

- Update the shared child event bridge to emit `awaiting_permission` when a child asks for approval.
- Restore `running` status after permission resolution.
- Wire teammate status updates through the same bridge so team cards can show permission waits.
- Keep the permission payload source metadata already added in Phase 1.
- Add backend tests around the bridge-level status transitions.

### 3. Card Rendering Unification

- Replace separate sub-agent and teammate badge logic in `MessageBubbles.jsx` with the shared presentation helper.
- Add `awaiting_permission` tone and label support to teammate status presentation.
- Keep tool-call status separate: `spawn_teammate` means "launched", while child status means "still running / waiting / completed".

### 4. Shared Trace Reference Normalization

- Add a frontend helper that turns a sub-agent or teammate trace reference into a normalized lazy-load request.
- Replace duplicate path parsing in `MessageBubbles.jsx`.
- Keep the current endpoints:
  - `/api/sub-agent-traces/:harnessId/:traceFile`
  - `/api/team-traces/:harnessId/:teamId/:traceFile`

### 5. Verification

- Run focused frontend and backend tests for the new helpers and bridge behavior.
- Run the full Node test suite.
- Run the frontend build.
- Document any pre-existing lint baseline separately if lint remains noisy.

## Acceptance Criteria

- Sub-agent cards and teammate cards show consistent labels and tones for child status.
- A child approval request is visible as `awaiting permission` before the user approves or denies it.
- `spawn_teammate` cards no longer imply the child completed just because launch succeeded.
- Trace lazy loading still works for both sub-agent and teammate traces.
- The phase is committed in small, reviewable commits.
