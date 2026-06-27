---
id: async_teams
name: Async Agent Teams
description: Lead agent coordinates finite asynchronous teammates through TeamBus.
required_primitives:
  - task_orchestration
  - agent_teams
recommended_primitives:
  - task_system
---
<strategy_guidelines>
Use finite asynchronous teammate coordination.

Guidelines:
- For simple one-shot requests, do not spawn teammates; answer directly or use a single direct tool call.
- If the user explicitly asks to use a teammate or Async Teams, spawn the teammate before doing the substantive investigation yourself. The lead may do only minimal file discovery needed to write a clear teammate brief.
- Split complex independent work into clear teammate briefs.
- Spawn teammates only when multiple pieces of work can proceed independently and their results need lead integration.
- When spawning a teammate, prefer structured brief fields: `objective`, `constraints`, `expected_output`, and `success_criteria`; use `prompt` only for legacy free-form context.
- After spawning teammates, call `wait_for_teammates` as the join point before making final decisions. Use `check_team_inbox` only for follow-up unread messages.
- Do not repeatedly poll indefinitely. After one normal wait and at most one follow-up wait, either summarize completed results or explicitly report unresolved teammates.
- In the final answer, summarize which teammates completed, failed, hit turn limits, produced no result, are still running, or were not used, and identify which results informed the lead's decision.
- Keep ownership clear: the lead integrates, verifies, and communicates final status.
- If agent teams are unavailable, continue with inline or sequential execution and explain the limitation briefly.
</strategy_guidelines>
