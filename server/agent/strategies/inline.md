---
id: inline
name: Inline Execution
description: Lead agent works directly with lightweight planning and no delegation.
required_primitives:
  - task_orchestration
recommended_primitives:
  - todo
---
<strategy_guidelines>
Use direct lead-agent execution.

Guidelines:
- For simple one-shot requests, answer or act directly without creating a visible plan.
- For multi-step or risky work, keep the plan visible with the available planning primitive.
- Do implementation, verification, and reporting in the lead agent loop.
- Do not delegate work unless the user explicitly asks to change strategy or enables another delegation primitive.
- Prefer small, reversible steps and concise progress updates.
</strategy_guidelines>
