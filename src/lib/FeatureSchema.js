export const FEATURE_SCHEMA = {
  enable_security: {
    type: 'boolean',
    label: '安全防护与规则审批防线',
    description: '拦截高危命令与越界文件写入操作，并通过前端弹窗获取授权。',
    defaultValue: false,
    failSafeValue: true, // 安全关键特性：解析损坏或异常时，默认 Fail-Closed 强行拦截防护
  },
  context_compaction: {
    type: 'group',
    label: '上下文优化与提示词缓存管理',
    description: '在大项目调试、多轮对话时，通过不同策略管理 Token 水位与优化响应速度。',
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
        label: '实时折叠已决思维链 (Thinking Compaction)',
        description: '在工具调用返回结果后，将冗长的 thinking 块折叠为轻量占位符 [Thinking folded]，保护 Prompt Cache 前缀稳定性。',
        defaultValue: true,
        failSafeValue: false,
      },
      output_offload: {
        type: 'boolean',
        label: '超长工具输出物理落盘 (Large Output Offload)',
        description: '每次工具调用后立即检查，将超过 20KB 的单条输出转存到本地 .offloaded 目录，防止单条结果撑爆上下文。',
        defaultValue: true,
        failSafeValue: false,
      },
      soft_compact: {
        type: 'boolean',
        label: '软清洗老历史文件 (Soft-Compact)',
        description: '在 Token 水位达到阈值后，批量掏空 5 轮前的 read_file/write_file/ls/grep/bash 工具结果，释放上下文空间。',
        defaultValue: true,
        failSafeValue: false,
      },
      hard_compact: {
        type: 'boolean',
        label: '大模型语义记忆重构 (Hard-Compact)',
        description: '在 Token 极度溢出时触发 LLM 自动生成历史记忆摘要，以最小代价重建核心上下文，保留最近 3 轮活跃记忆。',
        defaultValue: true,
        failSafeValue: false,
      },
    },
  },
  todo_nag: {
    type: 'boolean',
    label: '任务看板更新督促',
    description: '当连续 3 轮未更新任务看板时，自动向大模型追加看板更新的系统督促提示。',
    defaultValue: true,
    failSafeValue: true,
  },
  enable_skills: {
    type: 'group',
    label: '技能加载 (Skills)',
    description: '向 Agent 注入特定领域的行为规则技能，增强其在对应场景下的专业能力。',
    defaultValue: true,
    failSafeValue: true, // 技能只增强不拦截，安全降级时保持开启无害
    children: {
      enable_project_skills: {
        type: 'boolean',
        label: '加载项目本地技能',
        description: '从当前项目目录中自动发现并加载 Skill 定义文件，注入项目专属的工作流规则。',
        defaultValue: true,
        failSafeValue: true,
      },
      enable_global_skills: {
        type: 'boolean',
        label: '加载全局 .agent 目录技能',
        description: '挂载系统全局 ~/.agent（或 .agent/）目录下的通用超能力技能库。',
        defaultValue: true,
        failSafeValue: false,
      },
    },
  },
  parallel_tool_execution: {
    type: 'boolean',
    label: '并行工具执行',
    description: '单回合产生多个工具调用时并发执行，缩短整体工具执行的等待时间。',
    defaultValue: false,
    failSafeValue: false,
  },
};

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
      } else if (meta.type === 'group') {
        parsed[key] = {};
        const isGroupEnabled = typeof userVal === 'boolean'
          ? userVal
          : (userVal?.enabled !== undefined ? !!userVal.enabled : meta.defaultValue);

        parsed[key].enabled = isGroupEnabled;

        for (const [subKey, subMeta] of Object.entries(meta.children)) {
          let subVal;
          if (typeof userVal === 'boolean') {
            subVal = userVal;
          } else {
            subVal = userVal?.[subKey];
          }

          parsed[key][subKey] = isGroupEnabled
            ? (subVal !== undefined ? !!subVal : subMeta.defaultValue)
            : false;
        }
      }
    }
    return parsed;
  } catch (err) {
    console.error('[FeatureParser] 遇到异常损坏数据，拉起 Fail-Safe 熔断降级:', err);
    const failSafeData = {};
    for (const [key, meta] of Object.entries(FEATURE_SCHEMA)) {
      if (meta.type === 'boolean') {
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

