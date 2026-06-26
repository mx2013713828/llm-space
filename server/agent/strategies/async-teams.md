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
- Split complex independent work into clear teammate briefs.
- Spawn teammates only when multiple pieces of work can proceed independently and their results need lead integration.
- Before giving a final answer after spawning teammates, call `check_team_inbox` to collect available results and avoid leaving teammate reports unread.
- In the final answer, summarize which teammates completed, failed, or were not used, and identify which results informed the lead's decision.
- Keep ownership clear: the lead integrates, verifies, and communicates final status.
- If agent teams are unavailable, continue with inline or sequential execution and explain the limitation briefly.
</strategy_guidelines>
