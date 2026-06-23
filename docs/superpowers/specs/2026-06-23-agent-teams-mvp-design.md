# Agent Teams MVP Design

## Goal

Add a lightweight Agent Teams capability that lets a Lead agent spawn asynchronous teammates, exchange structured messages, and consume teammate results, while keeping the implementation small enough for the experimental platform.

The first release proves the core teamwork loop. It deliberately leaves full team protocols, autonomous task claiming, and worktree isolation for later phases, but its data model and runner boundaries are shaped so those phases can be added without replacing the MVP.

## Scope

This change includes:

- Adding an Agent Teams child switch under `features.task_orchestration`.
- Mounting Teams tools only through the canonical Task Orchestration policy.
- Introducing structured team messages and a file-backed TeamBus.
- Spawning finite asynchronous teammate runners.
- Letting the Lead send teammate messages and check its inbox.
- Injecting Lead inbox messages into the Lead's future context through one shared consumption path.
- Persisting enough teammate state for UI/debug visibility and future protocol upgrades.

This change does not include:

- Shutdown request/response.
- Permission bubbling.
- Plan approval gating.
- Autonomous task auto-claim.
- Worktree creation, cleanup, or task-worktree binding.
- Infinite teammate idle loops.
- A full teammate management dashboard.
- Cross-process durability guarantees beyond local file persistence.

## Relationship To Existing Orchestration

Agent Teams is a Task Orchestration capability, not a generic tool-mounting option. It sits beside, but does not replace:

- Todo mode and Task System mode.
- One-off `sub_agent` delegation.
- Background execution.
- Cron scheduling.

`sub_agent` remains synchronous, one-shot, and isolated. Teams are asynchronous, stateful, and message-based. The two features may share helper patterns, but the model-facing tools and runtime behavior stay distinct.

The MVP reuses:

- `AgentExecutor` for teammate execution.
- `subAgentProfile`'s isolation approach as a reference point.
- `taskOrchestration.js` for canonical managed-tool lists and capability gating.
- Existing harness session persistence patterns.
- Existing SSE/nested-event conventions where useful for trajectory visibility.

## Configuration

Task Orchestration gains one child switch:

```json
{
  "features": {
    "task_orchestration": {
      "enabled": true,
      "enable_agent_teams": false
    }
  }
}
```

The effective rule is:

- `task_orchestration.enabled !== true`: no Teams tools are mounted.
- `enable_agent_teams !== true`: no Teams tools are mounted.
- Both enabled: mount the MVP Teams tools.

The child value is preserved when the parent is disabled, matching the existing Task Orchestration preservation contract.

## MVP Tools

The Lead receives three Teams tools when Teams is enabled:

- `spawn_teammate`
- `send_team_message`
- `check_team_inbox`

Teammates receive:

- `send_team_message`
- Ordinary atomic tools inherited from the parent profile.

Teammates do not receive:

- `spawn_teammate`
- `check_team_inbox`
- `sub_agent`
- Todo or Task System tools in the first MVP
- Background tools
- Cron tools
- Memory
- Future protocol tools unless explicitly enabled by a later phase

This keeps MVP teammates useful for scoped async work without allowing recursive team creation or unmanaged orchestration recursion.

## Message Model

All team communication uses a structured envelope from day one:

```json
{
  "id": "msg_...",
  "teamId": "team_...",
  "from": "lead",
  "to": "alice",
  "type": "message",
  "createdAt": "2026-06-23T10:00:00.000Z",
  "payload": {
    "text": "Please inspect the API routes."
  },
  "requestId": null,
  "parentMessageId": null
}
```

MVP message types:

- `message`: ordinary teammate communication.
- `result`: teammate final result.
- `error`: teammate failed.
- `status`: teammate lifecycle update.

Reserved future message types:

- `shutdown_request`
- `shutdown_approved`
- `shutdown_rejected`
- `permission_request`
- `permission_response`
- `plan_approval_request`
- `plan_approval_response`
- `task_assignment`
- `idle_notification`

The reserved fields `requestId` and `parentMessageId` are optional in MVP but must be preserved by storage and display code. Future protocol matching uses `requestId`, so the field is part of the initial envelope instead of a later migration.

## TeamBus

The TeamBus is a small file-backed inbox system scoped by harness and team:

```text
server/sessions/<harnessId>_teams/<teamId>/inboxes/<agentId>.jsonl
server/sessions/<harnessId>_teams/<teamId>/state.json
```

Each inbox line is one `MessageEnvelope`. Sending appends one JSON line. Reading consumes available lines and clears the inbox file.

MVP locking is minimal. Writes use append-only file operations and reads are serialized inside the current process. A later protocols phase can add file locks without changing the envelope schema or tool contracts.

The bus exposes:

- `sendMessage(envelope): Promise<MessageEnvelope>`
- `readInbox({ harnessId, teamId, agentId }): Promise<MessageEnvelope[]>`
- `peekInbox({ harnessId, teamId, agentId }): Promise<MessageEnvelope[]>`

`check_team_inbox` and automatic Lead inbox injection both call one shared `consumeLeadInbox()` helper so protocol/status messages are never accidentally consumed by one path and skipped by the other.

## Team State

Team state is persisted separately from message inboxes:

```json
{
  "teamId": "team_default",
  "harnessId": "04-subagent",
  "createdAt": "2026-06-23T10:00:00.000Z",
  "teammates": {
    "alice": {
      "id": "alice",
      "name": "alice",
      "role": "backend developer",
      "status": "running",
      "turns": 2,
      "maxTurns": 6,
      "cwd": "/repo",
      "lastActiveAt": "2026-06-23T10:01:00.000Z",
      "lastError": null
    }
  }
}
```

MVP statuses:

- `running`
- `completed`
- `failed`

Reserved future statuses:

- `idle`
- `shutdown_requested`
- `shutdown_approved`
- `shutdown_rejected`

State updates are best-effort debug and UI data. The authoritative communication channel remains the inbox files.

## Teammate Profile

Teams get a dedicated profile helper instead of reusing `subAgentProfile` directly:

- `createTeammateFeatures(parentFeatures)`
- `selectTeammateTools(parentTools)`
- `createTeammateSystemPrompt({ name, role })`

The profile reuses the isolation principles from `subAgentProfile`:

- Deep-clone parent features.
- Disable memory.
- Disable Task Orchestration by default for the teammate.
- Re-add only Teams-safe tools explicitly.
- Keep security, skills, context compaction, and error recovery where safe.

Unlike one-off Sub-agents, teammates receive a persistent identity:

```text
You are teammate "alice", role: backend developer.
You work asynchronously for the Lead agent.
Send concise status and final result messages back to lead.
Do not spawn teammates.
```

The profile accepts `cwd` even though MVP defaults to `process.cwd()`. Worktree isolation can later pass a task-specific worktree path without changing the runner signature.

## Teammate Runner

The MVP runner is finite and asynchronous:

```js
runTeammate({
  parentExecutor,
  teamId,
  teammateId,
  name,
  role,
  initialPrompt,
  cwd = process.cwd(),
  maxTurns = 6,
  ExecutorClass = AgentExecutor
})
```

Runner behavior:

1. Create or update teammate state as `running`.
2. Start a child `AgentExecutor` with fresh messages and teammate profile.
3. At the start of each teammate turn, read teammate inbox and inject messages into the teammate context.
4. Execute up to `maxTurns`.
5. On final assistant text, send a `result` message to Lead.
6. On error, send an `error` message to Lead and mark state `failed`.
7. On completion, mark state `completed`.

MVP does not wait in an idle loop after the finite run. Future autonomous teams can replace step 4-7 with `work -> idle -> shutdown` while preserving the same TeamBus, state file, and message envelope.

## Lead Inbox Injection

Lead inbox injection happens before the Lead calls the model through a dedicated `TeamInboxPlugin.preLLM` hook:

1. Call `consumeLeadInbox({ harnessId, teamId })`.
2. Persist consumed messages into session messages as a compact system/user-visible event.
3. Add a context block such as:

```xml
<team_inbox>
<message from="alice" type="result">Schema review complete...</message>
</team_inbox>
```

The block is dynamic and appended near the active turn, not permanently embedded in the base system prompt. This keeps prompt caching more stable and mirrors the existing dynamic task-state injection pattern.

`check_team_inbox` uses the same consumption helper and returns a formatted text summary to the Lead. If automatic injection has already consumed messages, the tool reports that there are no pending messages rather than reading a second source.

## User Interface

The MVP UI changes are intentionally small:

- Add `Enable Agent Teams` under Task Orchestration's **Delegation** section.
- Hide Teams-managed tools from Tools Mounting.
- Render teammate status messages in the existing trajectory stream using the same compact style as other system/runtime events.

No full Teams dashboard is required in MVP. The first usable surface is the conversation trajectory and `check_team_inbox` tool output.

Future UI can add:

- Team roster.
- Teammate status pills.
- Inbox viewer.
- Protocol request review.
- Worktree binding and cleanup controls.

## Error Handling

- Invalid teammate names are rejected. Names must match `[A-Za-z0-9_-]{1,40}`.
- Sending to an unknown teammate returns a tool error.
- A teammate runner error becomes an `error` message to Lead and a `failed` state entry.
- Missing or corrupt team state is recreated from inbox/team inputs where possible.
- Malformed inbox lines are skipped and preserved in a `.bad` sidecar file for debugging.
- A disabled Teams feature stops new tool mounting but does not kill already-running teammate work.

## Future Evolution

### v2: Team Protocols

Add a request-response protocol layer:

- `ProtocolState`
- `requestId` matching
- shutdown request/approved/rejected
- plan approval request/response
- eventually permission request/response

The MVP envelope already carries `requestId`, `type`, and structured payloads, so v2 adds routing and state transitions rather than a storage migration.

### v3: Autonomous Teams

Add an idle loop:

- `running -> idle -> running`
- `idle_notification`
- inbox polling while idle
- task board scan and auto-claim
- timeout-based graceful completion

The MVP runner already has `maxTurns`, teammate state, and inbox injection points. v3 extends the runner lifecycle instead of replacing it.

### v4: Worktree Isolation

Add workspace isolation:

- worktree creation and validation
- task/worktree binding
- teammate `cwd` override
- keep/remove worktree lifecycle
- events log for audit

The MVP runner accepts `cwd` and the profile does not assume `process.cwd()`, so v4 can route teammate tools into isolated directories.

## Verification

Automated tests cover:

- Message envelope creation and validation.
- TeamBus send/read/consume behavior.
- Team state creation, status updates, and corrupt-state recovery.
- Teammate profile tool and feature isolation.
- Runner success, failure, finite turn limit, and Lead result delivery.
- Lead inbox consumption through both automatic injection and `check_team_inbox`.
- Task Orchestration policy mounting Teams tools only when parent and child are enabled.
- UI/schema preservation for the new `enable_agent_teams` child switch.

Manual verification covers:

- A Lead spawning a teammate and receiving a final result.
- A Lead sending a follow-up message before the teammate finishes.
- Disabling Teams prevents new Teams tool use without breaking existing sessions.
- Existing `sub_agent`, Task System, Background Tasks, and Cron behavior remains unchanged.
