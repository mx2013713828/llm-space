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
- Split independent work into clear teammate briefs.
- Spawn teammates only for work that can proceed independently.
- Use team inbox checks to collect results before making final decisions.
- Keep ownership clear: the lead integrates, verifies, and communicates final status.
- If agent teams are unavailable, continue with inline or sequential execution and explain the limitation briefly.
</strategy_guidelines>
