# Task 4 Report: Add Agent Teams Tools And Plugin

## What you implemented

- Added native tool schema files:
  - `server/tools/spawn_teammate.js`
  - `server/tools/send_team_message.js`
  - `server/tools/check_team_inbox.js`
- Registered the new team tools in `server/tools/ToolRegistry.js`.
- Implemented `server/agent/plugins/TeamPlugin.js` with:
  - `createTeamPlugin({ bus, stateStore, runTeammateFn } = {})`
  - exported singleton `TeamPlugin`
  - `preToolUse` interception for `spawn_teammate`, `send_team_message`, and `check_team_inbox`
  - `preLLM` unread Lead inbox injection via a compact `<team_inbox>` block
- Updated `server/agent/AgentExecutor.js` to register `TeamPlugin` only when:
  - `runtimeRole === 'teammate'`, or
  - `task_orchestration.enable_agent_teams === true`
- Added focused tests for:
  - TeamPlugin behavior
  - ToolRegistry team tool registration
  - AgentExecutor TeamPlugin activation

## What you tested and exact test results

Verification command run:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/agent/teams/*.test.js server/tools/ToolRegistry.test.js server/agent/AgentExecutor.orchestration.test.js
```

Result:

- Exit code: `0`
- `34` tests passed
- `0` tests failed

Included passing coverage for:

- TeamPlugin spawn/send/check/preLLM behavior
- existing team bus/state/envelope/profile/runner tests
- ToolRegistry registration of new team tools
- AgentExecutor TeamPlugin activation rules

## TDD Evidence: RED and GREEN commands/output summaries

RED command:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/tools/ToolRegistry.test.js server/agent/AgentExecutor.orchestration.test.js
```

RED summary:

- Exit code: `1`
- Failures confirmed expected missing work:
  - `ERR_MODULE_NOT_FOUND` for `server/agent/plugins/TeamPlugin.js`
  - TeamPlugin activation assertions failing in `AgentExecutor.orchestration.test.js`
  - ToolRegistry missing `spawn_teammate`, `send_team_message`, `check_team_inbox`

GREEN command:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/tools/ToolRegistry.test.js server/agent/AgentExecutor.orchestration.test.js
```

GREEN summary:

- Exit code: `0`
- `13` tests passed
- `0` tests failed

## Files changed

- `server/tools/spawn_teammate.js`
- `server/tools/send_team_message.js`
- `server/tools/check_team_inbox.js`
- `server/tools/ToolRegistry.js`
- `server/tools/ToolRegistry.test.js`
- `server/agent/plugins/TeamPlugin.js`
- `server/agent/plugins/TeamPlugin.test.js`
- `server/agent/AgentExecutor.js`
- `server/agent/AgentExecutor.orchestration.test.js`

## Self-review findings

- The plugin stays narrowly scoped to the MVP brief and reuses the existing team bus, state store, envelope validation, and teammate runner primitives.
- `spawn_teammate` is fire-and-forget and wraps runner failures with `.catch(...)` so rejected teammate runs do not become unhandled promise rejections.
- Lead inbox injection is transient and consumes unread messages once instead of persisting raw team state into chat history.

## Issues/concerns

- `TeamPlugin` currently keeps the active `teamId` in `executor.teamContext` for Lead after first spawn, which is enough for the MVP session flow in the brief, but it is in-memory session state rather than a separate persisted lead-session mapping.
- Team inbox formatting is intentionally compact and text-only for MVP scope; there is no richer rendering or message threading.

## Fix: persist lead team context across executors

### Files changed

- `server.js`
- `server/agent/AgentExecutor.js`
- `server/agent/AgentExecutor.orchestration.test.js`
- `server/agent/plugins/TeamPlugin.test.js`
- `src/hooks/useAgentLoop.js`

### What changed

- Persisted lightweight lead `teamContext` in `AgentExecutor.saveSession()` when present, while preserving existing `messages`, `todos`, and `backgroundTasks` session behavior.
- Updated `/api/agent/run` to accept `teamContext` and pass it into each new `AgentExecutor`.
- Updated the session sync endpoint to preserve an existing saved `teamContext` when the frontend posts ordinary message/todo/background task updates without one.
- Updated `useAgentLoop` to refresh the latest saved session before each `/api/agent/run` and forward `savedSession.teamContext` so later executors retain lead team routing and inbox injection.
- Kept teammate child executors on `harnessId: ''`, so teammate children still do not save sessions.
- Left `spawn_teammate` fire-and-forget behavior unchanged.

### Tests run and exact results

RED verification:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/agent/AgentExecutor.orchestration.test.js
```

- Exit code: `1`
- `12` passed, `2` failed
- Expected failures proved the gap:
  - `saveSession persists lightweight teamContext only when present`
  - `persisted and reloaded lead teamContext lets a later executor inject lead inbox messages`

GREEN regression rerun:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/agent/AgentExecutor.orchestration.test.js
```

- Exit code: `0`
- `14` passed, `0` failed

Required coverage command:

```bash
node --test server/agent/plugins/TeamPlugin.test.js server/agent/teams/*.test.js server/tools/ToolRegistry.test.js server/agent/AgentExecutor.orchestration.test.js
```

- Exit code: `0`
- `36` passed, `0` failed

Frontend build:

```bash
npm run build
```

- Exit code: `0`
- Vite production build completed successfully

### Self-review

- The persisted session state stays lightweight: only lead `teamContext` metadata is saved, never child transcripts or separate mapping files.
- Session sync is resilient now: backend saves include `teamContext`, and frontend autosaves no longer erase it if they post without that field.
- The later-executor regression is covered directly at the plugin boundary, which is where lost `teamContext` previously broke lead inbox injection and implicit tool routing.
- Teammate child execution remains isolated because child executors still run with `harnessId: ''`, so this fix does not widen session persistence scope.
