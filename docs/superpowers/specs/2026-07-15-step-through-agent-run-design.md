# Step-Through Agent Run Design

## Goal

Add an optional, human-paced runtime mode for the Trajectory workspace. A user can submit one prompt, inspect each meaningful Agent Loop boundary, and explicitly advance the run until it reaches a final answer.

This is a runtime control, not an execution strategy, tool policy, or system-prompt feature. It must not change model context, prompt-cache behavior, or the continuous run behavior.

## Scope

- Offer `Continuous` and `Step Through` modes when starting a trajectory run.
- In Step Through mode, pause at semantic checkpoints after a model response and after tool execution.
- Show the next pending action, including the exact tool or MCP tool names that will run.
- Use one stable primary action named `Next step`.
- Allow `Run to completion` for the current run only.
- Preserve existing security approval behavior and show it separately from step checkpoints.
- Keep a paused run reconnectable from the current browser session.

Out of scope:

- Pausing a model in the middle of thinking, text streaming, or partial tool arguments.
- Per-tool confirmation within a parallel tool batch.
- Recursive step controls inside sub-agents or teammates.
- Step-through execution for background jobs, cron runs, or a server restart recovery.

## Why Checkpoints Instead Of Token-Level Pauses

Thinking, text, and tool-input deltas belong to one active provider request. Stopping within that stream would require aborting the request and later asking the model to continue, which can duplicate output, lose tool-call structure, and reduce cache stability.

Step Through therefore waits only after a provider response has ended or after a tool batch has settled. At each point, the model connection is already closed and the executor can pause safely without holding an upstream request open.

## Run Modes

| Mode | Behavior |
| --- | --- |
| `continuous` | Existing behavior. The executor automatically advances through model and tool stages until it reaches a final answer, error, or normal stop condition. |
| `step_through` | The executor pauses at semantic checkpoints and waits for a user command. |

The frontend sends the selected mode as per-run metadata. It is not stored in `features`, not added to the Harness JSON, and not injected into the model messages. The UI may remember the user's local preference per Harness, but that preference remains browser-local.

## Checkpoint State Machine

```text
created
  -> model_streaming
  -> awaiting_tool_step       (model emitted executable tools)
  -> tool_running
  -> awaiting_model_step      (tools have settled)
  -> model_streaming
  -> completed                (model emitted a final response)

Any state -> awaiting_approval -> previous pending state
Any active or paused state -> aborted | failed | interrupted
```

### Model response boundary

The full thinking, text, and tool-call blocks stream normally. When the response requests tools, the executor enters `awaiting_tool_step` before executing them. The checkpoint describes the next action, for example:

- `Next: run weather_report`
- `Next: run 3 tools` with compact chips for `read_file`, `bash`, and `sub_agent`
- `Next: call MCP - context7/query-docs`

### Tool result boundary

After the selected tool batch has finished, the executor enters `awaiting_model_step`. The checkpoint says `Next: ask the model for its next decision`. Pressing `Next step` starts the next model request.

If the model response has no executable tools, it is the final answer and the run completes without a redundant checkpoint.

### Tool batches

The existing `parallel_tool_execution` setting remains authoritative. Step Through gates a batch, not individual calls: one user action starts the complete serial or parallel batch selected by the Harness. Tool-call cards continue to reveal input and output details.

## Child Agents, MCP, And Approvals

- `sub_agent` and `spawn_teammate` are normal tool calls at the parent checkpoint. The parent shows their tool name and any concise brief already available in the call card.
- Once started, child agents execute continuously in the MVP. Their existing bounded status/trajectory previews remain visible in the parent trajectory. Nested step controls are deferred because they create ambiguous ownership and a poor interaction model.
- MCP calls use the same batch checkpoint and show their namespaced tool name, such as `mcp__context7__query_docs`.
- Security approval has higher priority than step control. `Next step` never authorizes a protected tool. When an approval is required, the normal allow/deny card is shown; once resolved, the executor returns to the pending checkpoint or continues the already-authorized tool stage.
- Background and scheduled runs remain continuous because they do not have a reliable foreground user to advance them.

## UI

### Mode selection

The Trajectory run control exposes a compact mode selector beside `Run Trajectory`:

- `Continuous`
- `Step Through`

The selected mode is visible before a run begins. It does not create a new configuration card or alter Prompt Lab.

### Checkpoint card

A single trajectory card appears at the current execution tail only while paused. It contains:

- phase label: `Awaiting next step`;
- a concise `Next: ...` description;
- optional compact tool chips for multiple tools;
- stable primary button: `Next step`;
- secondary action: `Run to completion`;
- a stop action consistent with the existing run cancellation control.

The primary button never changes name. The descriptive line, not the button, explains the action. The card must have stable dimensions so tool labels cannot shift the surrounding message list.

## Runtime Architecture

### Run controller

Introduce a small in-memory `RunController` owned by the active-job record. It owns:

- `mode` (`continuous` or `step_through`);
- current lifecycle state and checkpoint metadata;
- a deferred promise used by `AgentExecutor` to await a `next`, `run_to_completion`, or `abort` command;
- subscribers for current SSE clients.

`AgentExecutor` receives the controller as runtime-only dependency. It emits `run_checkpoint` events and awaits the controller only at the two semantic boundaries. The executor remains responsible for model calls, tools, session persistence, and lifecycle hooks.

### API and SSE

- `POST /api/agent/run` accepts `runMode` and returns the existing event stream.
- The active-run record exposes an opaque `runId`.
- `POST /api/agent/runs/:runId/advance` accepts `next`, `run_to_completion`, or `abort`.
- SSE emits `run_checkpoint` and `run_control_state` with state, next-action description, and bounded tool metadata.
- Reattached clients receive the current control state from the active-run snapshot before later events.

The browser sends an advance request independently of the SSE stream. A paused executor holds no model request, so a temporary client disconnect is safe. Server restart cannot recover the in-memory controller; it marks the run interrupted and leaves its persisted trajectory intact.

### Configuration snapshot

At run start, the existing effective model, tools, features, guidance, and run mode are captured as one runtime request snapshot. Editing a Harness while a run is paused changes only later runs. This prevents one run from using mixed configuration across checkpoints.

## Error Handling And Performance

- A checkpoint has at most a small bounded list of tool summaries; full arguments remain in Tool Call cards.
- The frontend coalesces normal stream events exactly as it does now and treats checkpoint events as terminal, immediately flushed state transitions.
- The server sends SSE keepalive comments while a run is paused, and the client can reattach if the stream closes.
- Duplicate advance requests are idempotent. Only the first command valid for the current checkpoint resolves the deferred wait.
- A permission request, terminal result, abort, or error invalidates stale advance commands.
- Existing continuous runs, scheduler runs, and child runs must not allocate a controller or emit checkpoint events.

## Testing

- Unit-test the controller state machine, idempotent commands, stale commands, and `run_to_completion` transition.
- Test executor checkpoints before tool batches and after tool results, including a final text response with no checkpoint.
- Test security approval precedence and MCP/sub-agent tool summaries.
- Test active-job reattachment exposes paused state without replaying large trajectories.
- Test frontend checkpoint presentation, mode persistence, and stable tool-chip summaries.
- Run the full server suite and production build; manually verify continuous-mode regression, one-tool run, multiple-tool run, MCP call, sub-agent delegation, approval, refresh while paused, abort, and run-to-completion.

## Acceptance Criteria

1. Continuous mode remains behaviorally unchanged.
2. Step Through streams each model response normally, then pauses only at semantic boundaries.
3. The checkpoint explains the next action and tool names while the primary action remains `Next step`.
4. Security approval cannot be bypassed through step controls.
5. Sub-agent, teammate, and MCP calls are visible as parent-level next actions.
6. A paused foreground run survives browser refresh/reconnection but is safely marked interrupted after server restart.
7. The mode changes no model-visible prompt content and does not affect prompt-cache structure.
