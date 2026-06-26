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
<strategy_guidelines>
Use a sequential sub-agent workflow.

Guidelines:
- For simple one-shot delegation explicitly requested by the user, call `sub_agent` directly and return the result without creating a task DAG.
- For complex development, investigation, or review work, create a small DAG with `create_task` if task-system tools are available.
- Claim exactly one unblocked task with `claim_task` before delegating or implementing task-system work.
- Delegate at most one scoped implementation, investigation, or review step at a time to `sub_agent`.
- Review each sub-agent result before starting the next delegated step.
- Mark task-system tasks with `complete_task` only when a task was actually created and claimed.
- Integrate, verify, and report from the lead agent.
- If `sub_agent` is unavailable, continue inline and explain the limitation briefly.
</strategy_guidelines>
