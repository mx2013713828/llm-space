export const FEATURE_SCHEMA = {
  security_mode: {
    type: 'select',
    label: 'Security Shield Level',
    description: 'Choose the strictness of the security sandbox and manual review gate.',
    defaultValue: 'relaxed',
    failSafeValue: 'strict',
    options: [
      { value: 'full', label: 'Level 0: Full Access (No manual review)' },
      { value: 'relaxed', label: 'Level 1: Relaxed (Blacklist & High-Risk Interception)' },
      { value: 'strict', label: 'Level 2: Strict (Fail-Closed Whitelist)' }
    ]
  },
  context_compaction: {
    type: 'group',
    label: 'Context Optimization & Prompt Cache Management',
    description: 'Manage token watermarks and optimize response speed with various compaction strategies during large codebase analysis and multi-turn chat.',
    defaultValue: true,
    failSafeValue: false, // 辅助特性：异常时 Fail-Open 关闭，避免干扰正常执行
    children: {
      // 子项按 agent-loop 真实执行顺序排列，分两个阶段：
      //
      // 【postToolUse 阶段 - 每次工具调用返回后立即触发】
      // ① thinking_compaction：折叠已决思维链，保护 Prompt Cache 前缀
      // ② output_offload：超大输出立即落盘，防单条撑爆上下文
      //
      // 【preLLM 阶段 - 下一轮 LLM 调用前，满阈值才触发】
      // ③ soft_compact：批量清洗历史冗余工具输出
      // ④ hard_compact：终极保底，LLM 语义摘要重构全量记忆
      thinking_compaction: {
        type: 'boolean',
        label: 'Real-time Thinking Compaction',
        description: 'Fold verbose thinking blocks into lightweight [Thinking folded] placeholders immediately after tool execution returns, preserving Prompt Cache prefix stability.',
        defaultValue: true,
        failSafeValue: false,
      },
      output_offload: {
        type: 'boolean',
        label: 'Large Output Offload',
        description: 'Inspect output after every tool execution and offload outputs larger than 20KB to the local .offloaded directory, preventing massive tool outputs from exhausting context limits.',
        defaultValue: true,
        failSafeValue: false,
      },
      soft_compact: {
        type: 'boolean',
        label: 'Soft-Compact Historic File Tools',
        description: 'Bulk purge tool outputs from read_file/write_file/list_dir/grep_search/run_command from 5+ turns ago once token usage exceeds the threshold, freeing up context space.',
        defaultValue: true,
        failSafeValue: false,
      },
      hard_compact: {
        type: 'boolean',
        label: 'Semantic Memory Reconstruction (Hard-Compact)',
        description: 'Trigger LLM-based memory summarization when tokens are critically near limit, reconstructing the core context at minimal cost while retaining the most recent 3 active turns.',
        defaultValue: true,
        failSafeValue: false,
      },
    },
  },
  task_orchestration: {
    type: 'group',
    label: 'Task Orchestration',
    description: 'Configure task planning, delegation, background execution, and scheduled job management for the agent runtime.',
    defaultValue: true,
    failSafeValue: true,
    preserveChildrenWhenDisabled: true,
    children: {
      strategy: {
        type: 'select',
        section: 'Execution Strategy',
        label: 'Execution Strategy',
        description: 'Choose a high-level orchestration preset. Advanced primitive switches remain editable for experimentation.',
        defaultValue: 'custom',
        failSafeValue: 'custom',
        options: [
          { value: 'custom', label: 'Custom / Manual' },
          { value: 'inline', label: 'Inline Execution' },
          { value: 'sequential_subagent', label: 'Sequential Sub-agent Workflow' },
          { value: 'async_teams', label: 'Async Agent Teams' }
        ]
      },
      inline_strategy_prompt: {
        type: 'text_area',
        section: 'Execution Strategy',
        label: 'Inline Execution Guideline (XML Format)',
        description: 'Editable guideline injected when Inline Execution is selected. Reset restores the built-in preset.',
        defaultValue: `<strategy_guidelines>
Use direct lead-agent execution.

Guidelines:
- For simple one-shot requests, answer or act directly without creating a visible plan.
- For multi-step or risky work, keep the plan visible with the available planning primitive.
- Do implementation, verification, and reporting in the lead agent loop.
- Do not delegate work unless the user explicitly asks to change strategy or enables another delegation primitive.
- Prefer small, reversible steps and concise progress updates.
</strategy_guidelines>`,
        failSafeValue: ''
      },
      sequential_subagent_strategy_prompt: {
        type: 'text_area',
        section: 'Execution Strategy',
        label: 'Sequential Sub-agent Guideline (XML Format)',
        description: 'Editable guideline injected when Sequential Sub-agent Workflow is selected. Reset restores the built-in preset.',
        defaultValue: `<strategy_guidelines>
Use a sequential sub-agent workflow.

Guidelines:
- For simple one-shot delegation explicitly requested by the user, call \`sub_agent\` directly and return the result without creating a task DAG.
- For complex development, investigation, or review work, create a small DAG with \`create_task\` if task-system tools are available.
- Claim exactly one unblocked task with \`claim_task\` before delegating or implementing task-system work.
- Delegate at most one scoped implementation, investigation, or review step at a time to \`sub_agent\`.
- Review each sub-agent result before starting the next delegated step.
- Mark task-system tasks with \`complete_task\` only when a task was actually created and claimed.
- Integrate, verify, and report from the lead agent.
- If \`sub_agent\` is unavailable, continue inline and explain the limitation briefly.
</strategy_guidelines>`,
        failSafeValue: ''
      },
      async_teams_strategy_prompt: {
        type: 'text_area',
        section: 'Execution Strategy',
        label: 'Async Agent Teams Guideline (XML Format)',
        description: 'Editable guideline injected when Async Agent Teams is selected. Reset restores the built-in preset.',
        defaultValue: `<strategy_guidelines>
Use finite asynchronous teammate coordination.

Guidelines:
- For simple one-shot requests, do not spawn teammates; answer directly or use a single direct tool call.
- Split complex independent work into clear teammate briefs.
- Spawn teammates only when multiple pieces of work can proceed independently and their results need lead integration.
- When spawning a teammate, prefer structured brief fields: \`objective\`, \`constraints\`, \`expected_output\`, and \`success_criteria\`; use \`prompt\` only for legacy free-form context.
- After spawning teammates, call \`wait_for_teammates\` as the join point before making final decisions. Use \`check_team_inbox\` only for follow-up unread messages.
- In the final answer, summarize which teammates completed, failed, hit turn limits, produced no result, are still running, or were not used, and identify which results informed the lead's decision.
- Keep ownership clear: the lead integrates, verifies, and communicates final status.
- If agent teams are unavailable, continue with inline or sequential execution and explain the limitation briefly.
</strategy_guidelines>`,
        failSafeValue: ''
      },
      custom_strategy_prompt: {
        type: 'text_area',
        section: 'Execution Strategy',
        label: 'Custom / Manual Guideline (XML Format)',
        description: 'Editable guideline injected when Custom / Manual is selected. Clear this field to run without a full strategy guideline.',
        defaultValue: `<strategy_guidelines>
No strategy guideline is active. Follow the currently enabled primitives and the user's instructions.
</strategy_guidelines>`,
        failSafeValue: ''
      },
      mode: {
        type: 'select',
        section: 'Planning & Tracking',
        label: 'Task Operating Mode',
        description: 'Choose the task board engine and dependency resolution mechanism.',
        defaultValue: 'todo',
        failSafeValue: 'todo',
        options: [
          { value: 'todo', label: 'Write-Todo Linear Board (Classic)' },
          { value: 'task_system', label: 'Task-System DAG Dependencies (Advanced)' }
        ]
      },
      todo_prompt: {
        type: 'text_area',
        section: 'System Guidelines',
        label: 'Todo Mode System Guidelines (XML Format)',
        description: 'Behavioral guidelines injected into the System Prompt in real-time when the model operates in Todo mode.',
        defaultValue: `<todo_mode_guidelines>
Use the \`write_todos\` board for complex, multi-step work where visible progress tracking helps the user.

For simple one-shot requests, direct tool calls, direct sub-agent delegation, or quick factual lookups, do not create or update a todo board unless the user explicitly asks for task tracking.

When a todo board is warranted:
1. Break down the task into 3-8 pending sub-tasks with \`write_todos\`.
2. Each time you complete a sub-task, call \`write_todos\` to mark its status as "completed".
3. Keep the board aligned with actual implementation progress; do not work for multiple turns on a tracked task without updating the board.
</todo_mode_guidelines>`,
        failSafeValue: ''
      },
      task_system_prompt: {
        type: 'text_area',
        section: 'System Guidelines',
        label: 'Task System Guidelines (XML Format)',
        description: 'Behavioral guidelines injected into the System Prompt in real-time when the model operates in Task System mode.',
        defaultValue: `<task_system_guidelines>
Use the task dependency system for complex, multi-step development work with meaningful dependencies.

For simple one-shot requests, direct tool calls, direct sub-agent delegation, quick factual lookups, or small tasks without dependencies, do not create task-system tasks unless the user explicitly asks for task tracking.

When task-system tracking is warranted:
1. First, analyze the requirements and create a dependency tree of Tasks using \`create_task\`. Declare upstream dependencies using \`blockedBy\` (comma-separated IDs).
2. Call \`list_tasks\` to inspect the status of all current tasks.
3. Before writing any code, call \`claim_task\` to claim a pending task that is not blocked by any uncompleted upstream dependencies.
4. Once claimed successfully, use \`bash\`, \`read_file\`, and \`write_file\` to implement, debug, and verify the task.
5. Upon completion, call \`complete_task\` to mark it as "completed", which will automatically unlock downstream dependent tasks.
6. Only call \`complete_task\` for tasks that were actually created and claimed.
7. Do not work for multiple turns on a tracked task without updating the task board status.
</task_system_guidelines>`,
        failSafeValue: ''
      },
      enable_background_tasks: {
        type: 'boolean',
        section: 'Execution',
        label: 'Enable Background Task Runner',
        description: 'Enable non-blocking asynchronous task execution for slow operations. Provides real-time task notifications and white-box task monitoring in the UI.',
        defaultValue: false,
        failSafeValue: false,
      },
      enable_sub_agents: {
        type: 'boolean',
        section: 'Delegation',
        label: 'Enable Sub-agent Delegation',
        description: 'Allow the runtime to spawn and coordinate sub-agents for scoped work.',
        defaultValue: false,
        failSafeValue: false,
      },
      enable_agent_teams: {
        type: 'boolean',
        section: 'Delegation',
        label: 'Enable Agent Teams',
        description: 'Allow the lead agent to spawn finite asynchronous teammates and exchange structured team messages.',
        defaultValue: false,
        failSafeValue: false,
      },
      enable_cron_scheduler: {
        type: 'boolean',
        section: 'Scheduling',
        label: 'Cron Scheduler',
        description: 'Allow the agent to create, list, and cancel in-process scheduled tasks for the current harness.',
        defaultValue: false,
        failSafeValue: false,
      },
    }
  },
  enable_skills: {
    type: 'group',
    label: 'Skills Loading',
    description: 'Inject domain-specific behavioral skillsets into the agent to enhance its expertise in targeted scenarios.',
    defaultValue: true,
    failSafeValue: true, // 技能只增强不拦截，安全降级时保持开启无害
    children: {
      enable_project_skills: {
        type: 'boolean',
        label: 'Load Project-Local Skills',
        description: 'Automatically discover and load skill definition files from the project root, injecting project-specific workflow rules.',
        defaultValue: true,
        failSafeValue: true,
      },
      enable_global_skills: {
        type: 'boolean',
        label: 'Load Global Skills (~/.agent)',
        description: 'Mount general capability skillsets located in the global ~/.agent (or .agent/) directory.',
        defaultValue: true,
        failSafeValue: false,
      },
    },
  },
  enable_memory: {
    type: 'group',
    label: 'Long-term Memory System',
    description: 'Persist user preferences and project knowledge in the .memory/ directory to retain critical context across sessions and compactions. An index is injected into the system prompt (cache-friendly) with relevant memory entries retrieved on demand.',
    defaultValue: false,
    failSafeValue: false, // 辅助特性，异常时 Fail-Open 关闭
    children: {
      // 注意子项依赖关系（UI 层需要联动约束）：
      // memory_consolidate 依赖 memory_extract 开启（整理的前提是有提取）
      memory_extract: {
        type: 'boolean',
        label: 'Auto-extract Memory on Every Turn',
        description: 'Automatically extract user preferences, work habits, and project facts from the conversation using LLM after each session, writing them to persistent storage.',
        defaultValue: true,
        failSafeValue: false,
      },
      memory_consolidate: {
        type: 'boolean',
        label: 'Consolidate Memories Periodically',
        description: 'Trigger automatic deduplication, resolution of conflicts, and pruning of obsolete memories using LLM when memory items exceed 10 (limited to once every 24 hours). Requires "Auto-extract Memory on Every Turn" to be enabled.',
        defaultValue: false,
        failSafeValue: false,
        // 依赖约束：此子项须 memory_extract 开启才能生效（UI 层联动控制）
      },
    },
  },
  error_recovery: {
    type: 'group',
    label: 'Self-Healing & Disaster Recovery',
    description: 'Automatically attempt recovery or execute failover plans when LLM API calls encounter network fluctuations, truncation, limits, or overload errors.',
    defaultValue: true,
    failSafeValue: false,
    children: {
      max_tokens_escalation: {
        type: 'boolean',
        label: 'Escalate max_tokens & Auto-Continue',
        description: 'When truncated by max_tokens, silently scale up the max_tokens limit for a retry in the first stage, and inject an auto-continue prompt in the second stage.',
        defaultValue: true,
        failSafeValue: false,
      },
      reactive_compaction: {
        type: 'boolean',
        label: 'Reactive Context Compaction',
        description: 'Trigger an aggressive, emergency context compaction and reconstruction if the API returns a prompt_too_long error, then retry.',
        defaultValue: true,
        failSafeValue: false,
      },
      http_retry: {
        type: 'boolean',
        label: 'Retry on HTTP Errors (Exponential Backoff + Jitter)',
        description: 'Execute exponential backoff retries with randomized jitter when encountering network anomalies, 429 rate limits, or 529 service overloads.',
        defaultValue: true,
        failSafeValue: false,
      },
      fallback_model: {
        type: 'boolean',
        label: 'API Model Failover',
        description: 'Automatically switch subsequent API requests to the backup failover model after encountering 529 overload errors 3 times consecutively.',
        defaultValue: true,
        failSafeValue: false,
      },
      fallback_model_id: {
        type: 'select',
        label: 'Fallback Model ID',
        description: 'Select the fallback model for disaster recovery. The API key for this model must be configured in advance.',
        defaultValue: '',
        failSafeValue: '',
      },
      diminishing_returns: {
        type: 'boolean',
        label: 'Detect Loops & Diminishing Returns',
        description: 'Limit automatic continuation to a maximum of 3 retries, and trigger an immediate breaker if token increments from a single continuation fall below 50.',
        defaultValue: true,
        failSafeValue: false,
      },
    }
  },
  parallel_tool_execution: {
    type: 'boolean',
    label: 'Parallel Tool Execution',
    description: 'Execute multiple tool calls in parallel within a single turn to reduce the overall waiting time for tool execution.',
    defaultValue: false,
    failSafeValue: false,
  },
};

const LEGACY_TEXT_AREA_DEFAULTS = {
  task_orchestration: {
    inline_strategy_prompt: [
      `<execution_strategy id="inline">
Use direct lead-agent execution.

Guidelines:
- Keep the plan visible with the available planning primitive.
- Do implementation, verification, and reporting in the lead agent loop.
- Do not delegate work unless the user explicitly asks to change strategy or enables another delegation primitive.
- Prefer small, reversible steps and concise progress updates.
</execution_strategy>`
    ],
    sequential_subagent_strategy_prompt: [
      `<execution_strategy id="sequential_subagent">
Use a sequential sub-agent workflow.

Guidelines:
- If task-system tools are available, create a small DAG with \`create_task\` before the first delegation.
- Claim exactly one unblocked task with \`claim_task\` before delegating or implementing it.
- Delegate at most one implementation, investigation, or review step at a time to \`sub_agent\`.
- Review each sub-agent result before starting the next delegated step.
- Mark finished tasks with \`complete_task\` so the frontend Task DAG board stays synchronized.
- Integrate, verify, and report from the lead agent.
- If \`sub_agent\` is unavailable, continue inline and explain the limitation briefly.
</execution_strategy>`
    ],
    async_teams_strategy_prompt: [
      `<execution_strategy id="async_teams">
Use finite asynchronous teammate coordination.

Guidelines:
- Split independent work into clear teammate briefs.
- Spawn teammates only for work that can proceed independently.
- Use \`wait_for_teammates\` as the join point before making final decisions.
- Keep ownership clear: the lead integrates, verifies, and communicates final status.
- If agent teams are unavailable, continue with inline or sequential execution and explain the limitation briefly.
</execution_strategy>`
    ],
    custom_strategy_prompt: [
      `<execution_strategy id="custom">
No strategy guideline is active. Follow the currently enabled primitives and the user's instructions.
</execution_strategy>`
    ],
    todo_prompt: [
      `<todo_mode_guidelines>
You must use the \`write_todos\` tool to manage your development board to keep your progress synchronized with the user:
1. Upon receiving a complex request, immediately call \`write_todos\` to break down the task into 4-8 pending sub-tasks.
2. Each time you complete a sub-task, call \`write_todos\` to mark its status as "completed".
3. Ensure your task board status aligns with your actual implementation progress. Never write code for multiple turns without updating the task board.
</todo_mode_guidelines>`
    ],
    task_system_prompt: [
      `<task_system_guidelines>
When facing complex development tasks, you must use the task dependency system to organize your workflow:
1. First, analyze the requirements and create a dependency tree of Tasks using \`create_task\`. Declare upstream dependencies using \`blockedBy\` (comma-separated IDs).
2. Call \`list_tasks\` to inspect the status of all current tasks.
3. Before writing any code, call \`claim_task\` to claim a pending task that is not blocked by any uncompleted upstream dependencies.
4. Once claimed successfully, use \`bash\`, \`read_file\`, and \`write_file\` to implement, debug, and verify the task.
5. Upon completion, call \`complete_task\` to mark it as "completed", which will automatically unlock downstream dependent tasks.
6. Do not write code for multiple consecutive turns without updating the task board status.
</task_system_guidelines>`
    ],
  },
};

function normalizeTextAreaValue(groupKey, subKey, value, defaultValue) {
  if (typeof value !== 'string') {
    return value;
  }

  const legacyValues = LEGACY_TEXT_AREA_DEFAULTS[groupKey]?.[subKey] ?? [];
  return legacyValues.some(legacyValue => legacyValue.trim() === value.trim())
    ? defaultValue
    : value;
}

/**
 * parseFeatures - 依据 FEATURE_SCHEMA 解析、补全、翻译并做 Fail-Safe 熔断降级
 * @param {Object} inputFeatures 用户传入的 features 配置对象
 * @returns {Object} 规范解析后的 features
 */
export function parseFeatures(inputFeatures) {
  try {
    const parsed = {};
    for (const [key, meta] of Object.entries(FEATURE_SCHEMA)) {
      const userVal = inputFeatures?.[key];

      if (meta.type === 'boolean') {
        parsed[key] = userVal !== undefined ? !!userVal : meta.defaultValue;
      } else if (meta.type === 'select') {
        const hasOptions = Array.isArray(meta.options) && meta.options.length > 0;
        if (userVal === undefined) {
          parsed[key] = meta.defaultValue;
        } else if (!hasOptions || meta.options.some(option => option.value === userVal)) {
          parsed[key] = userVal;
        } else {
          parsed[key] = meta.defaultValue;
        }
      } else if (meta.type === 'group') {
        parsed[key] = {};
        const isGroupEnabled = typeof userVal === 'boolean'
          ? userVal
          : (userVal?.enabled !== undefined ? !!userVal.enabled : meta.defaultValue);

        parsed[key].enabled = isGroupEnabled;

        for (const [subKey, subMeta] of Object.entries(meta.children)) {
          let subVal;
          if (typeof userVal === 'boolean') {
            // 当父级为布尔值时，仅布尔子项继承此值；非布尔子项（如 select, text_area）应回退到默认值
            subVal = subMeta.type === 'boolean' ? userVal : undefined;
          } else {
            subVal = userVal?.[subKey];
          }

          if (subMeta.type === 'select') {
            const hasOptions = Array.isArray(subMeta.options) && subMeta.options.length > 0;
            const rawValue = subVal !== undefined ? subVal : subMeta.defaultValue;
            const normalizedValue = !hasOptions || subMeta.options.some(option => option.value === rawValue)
              ? rawValue
              : subMeta.defaultValue;
            parsed[key][subKey] = (isGroupEnabled || meta.preserveChildrenWhenDisabled)
              ? normalizedValue
              : subMeta.defaultValue;
          } else if (subMeta.type === 'text_area') {
            const rawValue = subVal !== undefined ? subVal : subMeta.defaultValue;
            parsed[key][subKey] = (isGroupEnabled || meta.preserveChildrenWhenDisabled)
              ? normalizeTextAreaValue(key, subKey, rawValue, subMeta.defaultValue)
              : subMeta.defaultValue;
          } else {
            parsed[key][subKey] = (isGroupEnabled || meta.preserveChildrenWhenDisabled)
              ? (subVal !== undefined ? !!subVal : subMeta.defaultValue)
              : false;
          }
        }
      }
    }
    return parsed;
  } catch (err) {
    console.error('[FeatureParser] Encountered corrupted data, trigger Fail-Safe fallback:', err);
    const failSafeData = {};
    for (const [key, meta] of Object.entries(FEATURE_SCHEMA)) {
      if (meta.type === 'boolean') {
        failSafeData[key] = meta.failSafeValue;
      } else if (meta.type === 'select') {
        failSafeData[key] = meta.failSafeValue;
      } else if (meta.type === 'group') {
        failSafeData[key] = { enabled: meta.failSafeValue };
        for (const [subKey, subMeta] of Object.entries(meta.children)) {
          failSafeData[key][subKey] = subMeta.failSafeValue;
        }
      }
    }
    return failSafeData;
  }
}
export const FeatureSchema = FEATURE_SCHEMA;
