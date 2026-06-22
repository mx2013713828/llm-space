# Task Orchestration Design

## Goal

Replace the narrowly named Task Dashboard configuration with one Task Orchestration boundary that controls planning, one-off delegation, background execution, and scheduled execution. At the same time, correct the current `sub_agent` isolation bugs and establish clean policy boundaries for a later Agent Teams feature.

Agent Teams itself is not part of this change.

## Scope

This change includes:

- Hard-migrating `features.task_manager` to `features.task_orchestration`.
- Moving the top-level Cron Scheduler switch into Task Orchestration.
- Moving `sub_agent` out of Tools Mounting and into Task Orchestration.
- Keeping `sub_agent` synchronous and one-shot.
- Centralizing automatic orchestration-tool mounting.
- Pausing scheduled execution while orchestration or Cron is disabled.
- Updating every checked-in Harness to the new configuration format.

This change does not include:

- Agent Teams, teammate lifecycle, or teammate messaging.
- Asynchronous/background Sub-agents.
- Forked Sub-agent context or prompt-cache sharing.
- Permission bubbling protocols.
- Compatibility parsing for the removed configuration format.

## Configuration

The canonical configuration becomes:

```json
{
  "features": {
    "task_orchestration": {
      "enabled": true,
      "mode": "todo",
      "enable_sub_agents": false,
      "enable_background_tasks": false,
      "enable_cron_scheduler": false,
      "todo_prompt": "...",
      "task_system_prompt": "..."
    }
  }
}
```

`mode` supports exactly `todo` and `task_system`. The parent `enabled` switch is the off state; a third `off` mode is unnecessary.

When the parent is disabled, all orchestration capabilities are effectively disabled. Child configuration values remain stored so that re-enabling the parent restores the previous choices. Feature parsing therefore preserves child values for this group while the runtime policy gates their effective behavior.

Invalid modes fail safely to `todo`.

## Orchestration Policy

Add one pure policy boundary that receives requested Harness tools and parsed Task Orchestration configuration, removes every system-managed orchestration tool, and then adds back only the tools enabled by policy.

System-managed tools are:

- `write_todos`
- `create_task`
- `list_tasks`
- `get_task`
- `claim_task`
- `complete_task`
- `sub_agent`
- `query_background_tasks`
- `schedule_cron`
- `list_crons`
- `cancel_cron`

Effective mounting rules:

- Parent disabled: mount none of the managed tools.
- `mode: todo`: mount `write_todos`.
- `mode: task_system`: mount the five DAG task tools.
- `enable_sub_agents`: mount `sub_agent`.
- `enable_background_tasks`: make `query_background_tasks` available through the existing background execution path.
- `enable_cron_scheduler`: mount the three Cron tools.

The policy accepts tool names represented as strings or tool-definition objects and removes duplicates. `get_current_time` remains a foundational tool outside this policy.

The policy is separate from `AgentExecutor` so a future TeamManager can reuse the same definitions without embedding team lifecycle into the task plugin.

## Sub-agent

The one-off Sub-agent keeps a fresh `messages` array and a dedicated system prompt. It runs synchronously, so the Lead waits for completion and receives one tool result.

The child receives:

- The parent's model, temperature, token limit, and thinking setting.
- Security, Skills, context optimization, and error-recovery configuration.
- Only atomic tools already available to the parent.
- Runtime Context and `get_current_time` through normal Executor construction.

The child does not receive:

- `sub_agent`
- TODO or Task System tools and prompts
- Background-task management
- Cron tools
- Long-term Memory injection and extraction
- Future Agent Teams tools

Child features are produced by a dedicated profile that sets `task_orchestration.enabled` and Long-term Memory to `false` without mutating the parent's features. Tool filtering uses the complete managed-tool set rather than a one-name blacklist.

The child system prompt explicitly instructs the agent to perform the task directly and not delegate. Physical tool removal remains the authoritative recursion guard.

Only the last non-empty assistant text response is returned to the Lead. Intermediate text, thinking, and tool results remain visible through nested trajectory events carrying `parentToolCallId`, but they are not copied into the Lead's message history. If no final text exists, the tool returns one stable explanatory result. Child errors become a tool result and do not crash the Lead loop.

The existing Executor cycle limit remains the safety limit. Async Sub-agents are intentionally deferred.

## Cron Pause Semantics

Disabling either Task Orchestration or its Cron child switch pauses scheduled execution for that Harness without deleting jobs.

Before a queued event starts, the runner reloads the target Harness and checks the effective orchestration policy:

- Enabled: start and record the run normally.
- Disabled: discard that occurrence, return the job to an idle state, and create no execution-history record.

Skipped occurrences do not increment attempt, success, or failure counters and are never replayed. Re-enabling Cron permits only future matching occurrences.

One-shot jobs are retained while queued and are removed only when an occurrence actually starts. If a queued one-shot occurrence is skipped because scheduling was disabled, the job returns to idle and remains available for a future matching time after re-enablement.

An event that has already started is not forcefully terminated. Missing Harness files, malformed configuration, and real startup failures retain the existing failed-run behavior; only an explicit disabled policy is a non-error skip.

## User Interface

The Experimental Features panel displays one collapsible **Task Orchestration** group. Its children are visually divided using lightweight schema section metadata rather than recursive schema groups:

1. **Planning & Tracking**
   - Dashboard Mode
   - Mode-specific system guidelines
2. **Delegation**
   - Enable One-off Sub-agents
3. **Execution**
   - Enable Background Tasks
4. **Scheduling**
   - Enable Cron Scheduler

When the parent is disabled, every child control is visibly disabled while retaining its stored value. Only the guidelines matching the selected planning mode are shown.

Tools Mounting hides all system-managed orchestration tools. It continues to show ordinary atomic tools such as shell, files, Web, weather, and current time. Context Inspector continues to show the final resolved tool schema sent to the model, including automatically mounted orchestration tools.

Trajectory tabs use the new configuration:

- TODO or Task view follows the planning mode.
- Background Tasks appears only when orchestration and background execution are enabled.
- Scheduled Tasks appears only when orchestration and Cron are enabled.
- Disabling the parent hides every orchestration-related tab.

No nonfunctional Agent Teams switch is shown in this release.

## Hard Migration

All checked-in `harnesses/*.json` files are migrated in one change:

- Rename `features.task_manager` to `features.task_orchestration`.
- Move top-level `features.enable_cron_scheduler` into the new group.
- Convert a mounted `sub_agent` tool into `enable_sub_agents: true`.
- Remove every system-managed orchestration tool from Harness `tools` arrays.
- Preserve existing planning mode, prompts, background setting, and Cron setting.

Runtime compatibility with `task_manager`, top-level `enable_cron_scheduler`, and manually mounted `sub_agent` is deliberately not retained. This repository is a controlled experimental platform, and permanent compatibility branches would obscure the canonical architecture.

Session files need no migration because messages, TODO state, and background-task state retain their current shapes. Existing persisted Cron jobs also retain their current shapes.

## Error Handling

- Corrupt Task Orchestration data uses Feature Schema fail-safe values.
- Unknown planning modes resolve to `todo`.
- Duplicate managed tools are normalized rather than rejected.
- Sub-agent errors are returned as tool results.
- A Sub-agent with no final answer returns a stable empty-result message.
- Explicitly disabled Cron occurrences are skipped without failure history.
- Missing or malformed Harnesses during scheduled execution remain real failures.
- Turning off orchestration does not kill work that has already begun.

## Verification

Automated tests cover:

- Parent gating and preserved child configuration.
- Tool normalization for strings, objects, duplicates, both planning modes, Sub-agent, background execution, and Cron.
- Sub-agent recursion prevention, feature isolation, retained atomic tools, final-text selection, and error containment.
- Cron enabled execution, parent-disabled skip, child-disabled skip, unchanged counters, no history entry, and future-only resume.
- A repository scan proving every Harness uses `task_orchestration` and contains no legacy keys or manually mounted managed tools.
- UI filtering of managed tools and visibility rules derived from the new group.

Final verification includes the complete server test suite, focused lint on changed files, a production build, and desktop browser screenshots of enabled, expanded, and disabled Task Orchestration states. Mobile layout work is outside this scope.
