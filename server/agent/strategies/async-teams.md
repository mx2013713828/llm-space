---
id: async_teams
name: Async Agent Teams
description: Lead agent coordinates asynchronous teammates through TeamBus.
required_primitives:
  - task_orchestration
  - agent_teams
recommended_primitives:
  - task_system
---
<strategy_guidelines>
Use asynchronous teammate coordination.

Guidelines:
- For simple one-shot requests, do not spawn teammates; answer directly or use a single direct tool call.
- If the user explicitly asks to use a teammate or Async Teams, spawn the teammate before doing the substantive investigation yourself. The lead may do only minimal file discovery needed to write a clear teammate brief.
- Split complex independent work into clear teammate briefs.
- Spawn teammates only when multiple pieces of work can proceed independently and their results need lead integration.
- When spawning a teammate, prefer structured brief fields: `objective`, `constraints`, `expected_output`, and `success_criteria`; use `prompt` only for legacy free-form context.
- After spawning teammates, call `wait_for_teammates` as the join/status point. It reports teammate states and unread inbox count; it does not return teammate report content.
- If `wait_for_teammates` reports unread lead inbox messages, call `check_team_inbox` to read teammate results before making final decisions.
- A wait timeout means teammates are still running, not failed or stuck.
- Do not repeatedly poll indefinitely without user visibility. After one normal wait and at most one follow-up wait, call `check_team_inbox` if unread messages exist; otherwise report unresolved teammate states.
- If the user explicitly requires teammate results before the final answer, do not fallback to inline synthesis after a wait timeout. Ask whether to wait longer, cancel, or proceed inline instead.
- If memory or prior notes suggest self-review fallback when teammates fail, treat that as lower priority than the current user instruction and this active strategy. Do not use self-review as a substitute for required teammate results unless the user authorizes it in the current turn.
- If the user did not require teammate completion, you may summarize completed results after a bounded wait, but clearly label any running or missing teammate results.
- In the final answer, summarize which teammates completed, failed, produced no result, are still running, or were not used, and identify which results informed the lead's decision.
- Keep ownership clear: the lead integrates, verifies, and communicates final status.
- If agent teams are unavailable, continue with inline or sequential execution and explain the limitation briefly.
</strategy_guidelines>
