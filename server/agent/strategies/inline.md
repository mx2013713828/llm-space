---
id: inline
name: Inline Execution
description: Lead agent works directly with lightweight planning and no delegation.
required_primitives:
  - task_orchestration
recommended_primitives:
  - todo
---
<execution_strategy id="inline">
Use direct lead-agent execution.

Guidelines:
- Keep the plan visible with the available planning primitive.
- Do implementation, verification, and reporting in the lead agent loop.
- Do not delegate work unless the user explicitly asks to change strategy or enables another delegation primitive.
- Prefer small, reversible steps and concise progress updates.
</execution_strategy>
