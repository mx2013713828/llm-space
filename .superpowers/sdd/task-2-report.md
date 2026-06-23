# Task 2 Report: Add Team Message Envelope, Bus, And State Store

## What you implemented

- Added `server/agent/teams/teamEnvelope.js` with the required exports:
  - `TEAM_MESSAGE_TYPES`
  - `validateAgentName(name)`
  - `createTeamId()`
  - `createTeammateId(name)`
  - `createMessageEnvelope(input)`
- Implemented teammate-name validation with the exact required pattern: `[A-Za-z0-9_-]{1,40}` and readable validation errors.
- Implemented message envelope creation with:
  - `id`
  - `createdAt`
  - `teamId`
  - `from`
  - `to`
  - `type`
  - `payload`
- Added `server/agent/teams/teamBus.js` with `createTeamBus({ rootDir })` returning:
  - `sendMessage`
  - `readInbox`
  - `peekInbox`
- Implemented file-backed inbox storage as JSONL under:
  - `server/sessions/${harnessId}_teams/${teamId}/inboxes/${agentId}.jsonl`
- Implemented inbox consumption behavior:
  - `sendMessage()` appends JSONL to the receiver inbox
  - `peekInbox()` reads valid messages without consuming them
  - `readInbox()` returns valid messages, clears the inbox, and copies malformed lines to `${agentId}.jsonl.bad`
- Added `server/agent/teams/teamStateStore.js` with `createTeamStateStore({ rootDir })` returning:
  - `loadState`
  - `saveState`
  - `createTeam`
  - `upsertTeammate`
  - `updateTeammate`
- Implemented file-backed state storage under:
  - `server/sessions/${harnessId}_teams/${teamId}/state.json`
- Centralized team session path calculation inside the teams store implementation and reused it from the bus.

## What you tested and exact test results

Verification command from the brief:

```bash
node --test server/agent/teams/*.test.js
```

Final result:

- Exit code: `0`
- Tests: `11`
- Passed: `11`
- Failed: `0`
- Duration: about `50.13ms`

## TDD Evidence: RED and GREEN commands/output summaries

### RED

Command:

```bash
node --test server/agent/teams/*.test.js
```

RED summary:

- Exit code: `1`
- Failure mode: all three new test files failed because the implementation modules did not exist yet
- Missing modules:
  - `server/agent/teams/teamEnvelope.js`
  - `server/agent/teams/teamBus.js`
  - `server/agent/teams/teamStateStore.js`
- Runner summary:
  - Tests: `3`
  - Passed: `0`
  - Failed: `3`

### GREEN

Command:

```bash
node --test server/agent/teams/*.test.js
```

GREEN summary:

- Exit code: `0`
- `11/11` tests passed

## Files changed

- `server/agent/teams/teamEnvelope.js`
- `server/agent/teams/teamEnvelope.test.js`
- `server/agent/teams/teamBus.js`
- `server/agent/teams/teamBus.test.js`
- `server/agent/teams/teamStateStore.js`
- `server/agent/teams/teamStateStore.test.js`

## Self-review findings

- The implementation stays inside the exact teams file set named by the brief.
- The bus and state store both default storage under `server/sessions`, matching the required local file-backed scope.
- Malformed JSONL handling is intentionally forgiving: valid inbox messages are delivered, malformed lines are skipped from results, and the raw bad lines are preserved in `.bad`.
- The state store keeps a minimal durable shape centered on `teamId` and `teammates`, which is enough for the current task without inventing extra runtime behavior.

## Issues/concerns

- No functional concerns from the scoped Task 2 implementation.
- `sendMessage()` requires `harnessId` in order to place the message in the required session-scoped path; the brief’s example omitted that field, so the implementation follows the required storage layout rather than the abbreviated example call.

## Review Fix: Constrain team storage paths

### Files changed

- `server/agent/teams/teamPathGuards.js`
- `server/agent/teams/teamEnvelope.js`
- `server/agent/teams/teamStateStore.js`
- `server/agent/teams/teamBus.test.js`
- `server/agent/teams/teamStateStore.test.js`

### What changed

- Added a shared storage-id validator for `harnessId` and `teamId` that accepts only letters, numbers, underscore, and hyphen.
- Added a resolved-path containment check before building team storage paths under `server/sessions`.
- Reused the team-id validator in `createMessageEnvelope()` so bus writes reject invalid `teamId` values before path construction.
- Added regression tests covering traversal rejection through the team bus and state store surfaces.

### Tests run

Command:

```bash
node --test server/agent/teams/*.test.js
```

Exact result:

- Exit code: `0`
- Tests: `13`
- Passed: `13`
- Failed: `0`
- Duration: about `52.10ms`

### Self-review

- Scope stayed limited to Task 2 team files plus this report.
- The fix preserves the existing requirement that `sendMessage()` receives `harnessId`.
- The validator allows current normal IDs such as `h1`, `team_1`, and generated `team_<hex>` values while rejecting separators and traversal inputs like `../escape`.
- The extra containment check keeps filesystem writes scoped under the configured sessions root even if future callers regress on validation.

## Re-review Fix: Make inbox consumption append-safe

### Files changed

- `server/agent/teams/teamBus.js`
- `server/agent/teams/teamBus.test.js`
- `.superpowers/sdd/task-2-report.md`

### What changed

- Replaced `readInbox()`'s read-then-truncate flow with an append-safe handoff that atomically renames the inbox file to a unique processing snapshot.
- Recreated the live inbox with append semantics immediately after handoff so later `sendMessage()` calls write into the fresh inbox instead of being truncated away.
- Kept `peekInbox()` unchanged, continued parsing the handed-off snapshot for valid messages, copied malformed lines to `.bad`, and removed the temporary processing file after consumption.
- Added a regression test seam via a private `_testHooks.afterInboxSnapshot` option on `createTeamBus()` and used it only in tests to prove a message appended after snapshot handoff is delivered on the next `readInbox()`.

### Tests run

RED command:

```bash
node --test server/agent/teams/teamBus.test.js
```

RED result:

- Exit code: `1`
- Tests: `5`
- Passed: `4`
- Failed: `1`
- Failure: `readInbox keeps messages appended after snapshot handoff for the next read` expected the second read to contain the post-handoff message, but got `0`

GREEN command:

```bash
node --test server/agent/teams/*.test.js
```

GREEN result:

- Exit code: `0`
- Tests: `14`
- Passed: `14`
- Failed: `0`
- Duration: about `56.13ms`

### Self-review

- Scope stayed limited to the TeamBus implementation, its tests, and this report.
- The consume protocol now isolates a stable snapshot for parsing, which closes the truncation race without changing the production `sendMessage`/`readInbox`/`peekInbox` surface.
- The private hook is narrowly scoped to test orchestration and does not affect normal callers unless they deliberately opt into `_testHooks`.
