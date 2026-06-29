# Agent Harness Profiles and Unbounded Child Runtime Design

Date: 2026-06-29
Status: Proposed design for review
Scope: `sub_agent`, async teammates, future agent teams, and child-agent runtime foundations

## Summary

`sub_agent` and async teammates should not be treated as separate runtimes. They are different harness profiles assembled from the same lower-level capabilities: identity, tool policy, feature policy, prompt profile, event bridge, permission workflow, cancellation, trace persistence, and output contract.

The target architecture is an **Agent Harness Profile** system backed by an **Unbounded Child Runtime**. A child agent should run until it naturally reaches a terminal state, is cancelled by the user, fails, or cannot continue after a permission/provider error. It should not fail merely because it used a fixed number of ReAct turns.

The first development phase should lay foundations without trying to preserve every current behavior. The long-term goal is a clean runtime model that can support sub-agents, teammates, agent teams, reviewers, verifiers, and future autonomous pools through reusable profiles rather than plugin-specific branching.

## Current Problems

### Split Runtime Concepts

Today, `sub_agent` and teammate execution are implemented through separate flows:

- `server/agent/subAgentProfile.js`
- `server/agent/plugins/SubAgentPlugin.js`
- `server/agent/teams/teammateRunner.js`
- `server/agent/teams/teammateProfile.js`
- `server/agent/plugins/TeamPlugin.js`

They both create child `AgentExecutor` instances, trim tools/features, forward selected events, persist traces, and interpret final output. The duplicated responsibilities are already causing divergent behavior.

### `turn_limit` Created Incidental Complexity

The fixed `maxTurns` model caused several layers of compensating logic:

- final synthesis after tool-turn exhaustion
- `turn_limit` as a teammate state
- special handling for text-encoded tool calls during final synthesis
- UI/status presentation for `turn_limit`
- discussions around extend turns and resume-after-limit

This is the wrong center of gravity. A child agent's business state should not depend on an arbitrary ReAct loop count.

### Permission Workflow Is Runtime-Level, Not Plugin-Level

Teammates and sub-agents sometimes need user approval for legitimate work: writing a test fixture, running a command, touching files, or using a controlled scratch area. Approval should be visible, resumable, and attributable to the child agent that requested it. It should not be hidden inside a child executor or treated as a failure by default.

### Frontend Observability Is Still Fragmented

Sub-agent cards and teammate cards display different status models. Permission modals currently focus on a single pending permission object and are not designed as a generalized child-agent approval workflow.

## Design Goals

1. Model lead, sub-agent, teammate, reviewer, verifier, and future team workers as **harness profiles** over the same executor runtime.
2. Remove `maxTurns` and `turn_limit` from child-agent product semantics.
3. Preserve safety through cancellation, approval, provider timeouts, and low-level watchdogs rather than turn count limits.
4. Make permission requests first-class child runtime events.
5. Reuse profile, event bridge, outcome, trace, and permission logic between sub-agents and teammates.
6. Keep adapters for existing external behavior while moving shared behavior into foundation modules.
7. Design for future teams-v2 and autonomous pools without overbuilding them in the first phase.

## Non-Goals

- Do not make sub-agent and teammate UX identical. Their orchestration semantics remain different.
- Do not merge TeamBus into the child runtime. TeamBus is a teammate/team adapter concern.
- Do not make all child agents read-only. Some child agents should be allowed to request approval for controlled writes or verification.
- Do not implement autonomous team pools in the first phase.
- Do not preserve `turn_limit` as a new feature. It is a legacy migration concern only.

## Core Concept: Agent Harness Profile

A profile is a declarative bundle that describes how an `AgentExecutor` should run.

```ts
type AgentHarnessProfile = {
  identity: ChildIdentity;
  prompt: PromptProfile;
  tools: ToolPolicy;
  features: FeaturePolicy;
  events: EventBridgePolicy;
  permissions: PermissionPolicy;
  cancellation: CancellationPolicy;
  output: OutputContract;
  persistence: PersistencePolicy;
};
```

Profiles should be created by small profile builders, not scattered conditionals:

- `createLeadProfile(...)`
- `createSubAgentProfile(...)`
- `createTeammateProfile(...)`
- future `createReviewerProfile(...)`
- future `createVerifierProfile(...)`

## Target Runtime Model

```text
AgentExecutor
└─ AgentHarnessProfile
   ├─ identity
   ├─ prompt profile
   ├─ tool policy
   ├─ feature policy
   ├─ permission policy
   ├─ event bridge
   ├─ cancellation policy
   ├─ output contract
   └─ persistence policy
```

`sub_agent` and teammate become adapters over this profile runtime:

```text
SubAgentPlugin
└─ SubAgentAdapter
   └─ runChildAgent(profile)

TeamPlugin
└─ TeammateAdapter
   └─ runChildAgent(profile)
      └─ TeamBus / team state / inbox
```

## Child Runtime States

The new child runtime should use a small state model:

```text
running
awaiting_permission
completed
failed
cancelled
no_result
```

State meanings:

- `running`: child is actively thinking, using tools, or producing output.
- `awaiting_permission`: child is blocked on user approval.
- `completed`: child produced an output satisfying its output contract.
- `failed`: child hit an unrecoverable runtime/provider/tool error.
- `cancelled`: user or parent runtime cancelled it.
- `no_result`: child stopped without satisfying its output contract.

`turn_limit` should be removed from the runtime state model. Existing traces or persisted team states may still contain `turn_limit`; adapters can map old values for display during migration, but new runs should not create it.

## Unbounded Execution

Child agents should not receive a fixed turn count. Instead:

- Run until terminal state.
- Allow user cancellation.
- Allow permission approvals/denials to control progress.
- Keep provider request timeouts and network retry policies.
- Keep a low-level watchdog only as crash protection, not as product state.

The old `AgentExecutor.run(maxTurns = 15)` shape should eventually become:

```ts
run({
  cancellationSignal,
  stopPolicy,
  runtimeRole,
})
```

Where `stopPolicy` controls semantic constraints such as tool availability and final text requirements, not a turn budget.

## Permission Workflow

Permission requests should be normalized across lead, sub-agent, and teammate:

```ts
type PermissionRequest = {
  toolCallId: string;
  toolName: string;
  toolInput: unknown;
  reason: string;
  riskLevel?: 'info' | 'warning' | 'danger';
  source: {
    runtimeRole: 'lead' | 'sub_agent' | 'teammate';
    childId?: string;
    name?: string;
    role?: string;
    parentToolCallId?: string;
    teamId?: string;
  };
};
```

The frontend should show:

- who requested the action
- what task they are working on
- why approval is required
- the exact tool and arguments
- whether approving resumes a sub-agent, teammate, or lead run
- deny/allow actions

The permission workflow should not be hidden in child traces. It should be visible on both:

- the global approval UI
- the relevant child card

## Scratch Workspace Policy

Some child agents need to verify findings by writing temporary scripts or fixtures. Blocking all writes makes code review weaker. The runtime should provide a controlled scratch area:

```text
.agent-scratch/<runId>/<childId>/
```

Policy:

- Child agents may request approval to write inside scratch.
- Scratch paths are inside the workspace and auditable.
- `/tmp` and other outside-workspace paths remain suspicious or blocked.
- Scratch contents can be cleaned by run/session cleanup.
- The child prompt should prefer scratch for temporary verification.

This is a safety improvement over both extremes: fully blocking verification, or allowing arbitrary `/tmp` writes.

## Event Bridge

`childEventBridge` should be a shared module. It translates child executor events into parent-observable child runtime events.

Common forwarded/derived events:

- `child_status`
- `child_permission_request`
- `child_permission_resolved`
- `child_tool_start`
- `child_tool_done`
- `child_trace_ready`
- `child_cancelled`
- `child_failed`

Adapters can map these to existing UI events during migration:

- sub-agent adapter maps to `sub_agent_status` and `sub_agent_trace_ready`.
- teammate adapter maps to `team_update`, TeamBus messages, and teammate traces.

## Output Contracts

Different profiles require different completion contracts:

### Sub-agent

Contract:

- final assistant text is required
- parent tool output receives that text
- trace is persisted

If no final text exists, status is `no_result`.

### Teammate

Contract:

- final assistant text is required
- result is delivered to lead inbox
- team state is updated
- trace is persisted

`send_team_message` can be used for progress, but should not replace final text unless the profile explicitly allows message-only completion.

### Future Reviewer / Verifier

Reviewer profile:

- may be read-only by default
- requires structured findings
- may optionally request verification mode

Verifier profile:

- may use scratch
- may run tests/commands
- requires reproduction evidence

## Persistence and Trace

Sub-agent and teammate traces should converge toward a shared child trace schema:

```ts
type ChildTrace = {
  schema: 'llm-space.child_trace.v1';
  childType: 'sub_agent' | 'teammate' | 'reviewer' | 'verifier';
  childId: string;
  parentHarnessId: string;
  teamId?: string;
  parentToolCallId?: string;
  name?: string;
  role?: string;
  prompt: string;
  status: ChildState;
  finalAnswer?: string;
  error?: string;
  startedAt: string;
  completedAt?: string;
  summary: TraceSummary;
  messages: unknown[];
};
```

Storage paths may remain adapter-specific in early phases. The schema should become shared before paths are unified.

## TeamBus Boundary

TeamBus remains outside the core child runtime.

The child runtime knows how to run a teammate profile and emit outcome events. The teammate adapter knows how to:

- update team state
- send inbox messages
- format team status
- integrate with `wait_for_teammates`
- integrate with `check_team_inbox`

This keeps the child runtime reusable for non-team child agents.

## Cancellation

Cancellation replaces turn extension as the primary user control.

Design:

- parent can cancel a child run
- child executor receives `AbortSignal`
- long-running tool execution should be cancellable where possible
- cancellation produces `cancelled`, not `failed`
- trace records cancellation reason and timestamp

Initial UI:

- child card shows `Cancel`
- global run can cancel all children
- permission modal can deny current action without cancelling the whole child unless the child cannot continue

## Migration Plan

### Phase 1: Foundation Without External Behavior Rewrite

Goals:

- introduce shared child concepts while keeping current adapters
- remove new production creation of `turn_limit`
- bridge sub-agent permission events
- centralize child outcome logic

Work:

1. Add `childOutcome` shared module.
2. Add `childEventBridge` shared module.
3. Update sub-agent to bridge permissions through shared bridge.
4. Update teammate to use shared bridge.
5. Convert unavailable text-encoded tool call handling to non-final system status.
6. Stop using child `maxTurns` in new profile paths.

### Phase 2: Profiles and Policies

Goals:

- extract profile builders
- stop scattering tool/feature trimming logic

Work:

1. Add `childAgentProfile` module.
2. Move sub-agent feature/tool policy into profile builder.
3. Move teammate feature/tool policy into profile builder.
4. Add `reviewer` and `verifier` profile presets as internal building blocks.
5. Add scratch workspace policy.

### Phase 3: UI Unification

Goals:

- make child execution observable and controllable

Work:

1. Add shared `ChildAgentStatus` presentation model.
2. Show permission source consistently for lead, sub-agent, and teammate.
3. Show `awaiting_permission` on the child card.
4. Add child cancel action.
5. Add trace lazy loading through shared schema.

### Phase 4: Team Runtime Cleanup

Goals:

- make teams-v2 a composition of child profiles, not a separate runtime

Work:

1. Keep TeamBus as protocol layer.
2. Make teammate adapter consume child runtime outcomes.
3. Simplify `wait_for_teammates` around `running`, `awaiting_permission`, `completed`, `failed`, `cancelled`, `no_result`.
4. Remove `turn_limit` from team state creation.

### Phase 5: Legacy Removal

Goals:

- delete old turn-limit-centered code

Work:

1. Remove `maxTurns` from child spawn schemas or mark as ignored/deprecated.
2. Remove final synthesis after tool-turn exhaustion for child runtimes.
3. Migrate display of old `turn_limit` traces to a legacy badge.
4. Delete obsolete tests that encode turn-limit behavior.

## Testing Strategy

Backend tests:

- profile builder snapshots for sub-agent and teammate
- child event bridge permission request/resolution
- child outcome completed/no_result/failed/cancelled
- scratch path policy allows workspace scratch and rejects outside workspace
- teammate adapter sends inbox result from child outcome
- sub-agent adapter writes parent tool output from child outcome

Frontend tests:

- permission source formatting for lead/sub-agent/teammate
- child status display for running/awaiting_permission/completed/failed/cancelled/no_result
- trace lazy loading still works for existing sub-agent and teammate traces
- legacy `turn_limit` state displays as legacy only

Integration tests:

- sub-agent requests approval and continues after allow
- teammate requests approval and continues after allow
- user denies child permission; child either continues with denial result or ends predictably
- user cancels running child
- teammate completes and lead receives inbox result

## Risks

### Infinite or Runaway Child Agents

Removing turn limits shifts responsibility to cancellation, observability, and watchdogs. This is intentional, but the UI must make long-running children visible and cancellable.

Mitigation:

- show elapsed runtime
- show current action/tool
- support cancel
- keep provider/tool timeouts
- keep low-level crash watchdog outside product state

### Refactor Blast Radius

Sub-agent and teammate paths are user-visible and recently stabilized.

Mitigation:

- introduce shared modules first
- keep adapters stable
- migrate one responsibility at a time
- maintain tests around current external behavior until adapters are fully replaced

### Permission Queue Complexity

Multiple children may request permission at once.

Mitigation:

- Phase 1 can keep single active permission while normalizing source metadata.
- Later phase introduces permission queue.

## Design Decisions

1. Scratch workspace is available to verifier/tester-style profiles, but writes still go through the permission workflow unless the user explicitly chooses a more permissive profile. Read-only reviewer profiles do not get scratch writes by default.
2. `send_team_message` does not satisfy the teammate final output contract by default. A future profile may opt into message-only completion explicitly, but the default teammate contract requires final assistant text.
3. Cancelling the lead run cancels all active child runs by default. Individual child cancellation remains available from the child card.
4. The child trace schema should become shared before storage paths are unified. Early phases may keep existing sub-agent and teammate directories while writing compatible trace fields.

## Recommended First Implementation Plan

The first implementation plan should not attempt a total rewrite. It should establish the foundation:

1. Add shared child outcome module.
2. Add shared child event bridge module.
3. Use bridge in sub-agent and teammate.
4. Add permission source metadata for sub-agent.
5. Remove new `turn_limit` production from child paths.
6. Add tests proving child permission and no-result handling are shared.

This gives the project a clear architectural direction while avoiding a risky all-at-once rewrite.
