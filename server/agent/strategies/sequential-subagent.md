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
- Create or maintain a clear task plan before delegation.
- Delegate at most one implementation or investigation step at a time to `sub_agent`.
- Review each sub-agent result before starting the next delegated step.
- Integrate, verify, and report from the lead agent.
- If `sub_agent` is unavailable, continue inline and explain the limitation briefly.
</execution_strategy>
