---
id: sequential_subagent
name: Sequential Sub-agent Workflow
description: Plan first, delegate one scoped task at a time, review, fix, then advance.
required_primitives:
  - task_orchestration
  - sub_agent
recommended_primitives:
  - task_system
---
<execution_strategy id="sequential_subagent">
Use a sequential sub-agent workflow.

Guidelines:
- If task-system tools are available, create a small DAG with `create_task` before the first delegation.
- Claim exactly one unblocked task with `claim_task` before delegating or implementing it.
- Delegate at most one implementation, investigation, or review step at a time to `sub_agent`.
- Review each sub-agent result before starting the next delegated step.
- Mark finished tasks with `complete_task` so the frontend Task DAG board stays synchronized.
- Integrate, verify, and report from the lead agent.
- If `sub_agent` is unavailable, continue inline and explain the limitation briefly.
</execution_strategy>
