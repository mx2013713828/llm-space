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
      soft_compact: {
        type: 'boolean',
        label: '软清洗老历史文件 (Soft-Compact)',
        description: '对 5 轮前的 read_file/write_file/ls/grep/bash 内容进行静默掏空折叠。',
        defaultValue: true,
        failSafeValue: false,
      },
      hard_compact: {
        type: 'boolean',
        label: '大模型语义记忆重构 (Hard-Compact)',
        description: '在 Token 极度溢出时触发 LLM 自动生成历史记忆摘要，重建核心上下文。',
        defaultValue: true,
        failSafeValue: false,
      },
      thinking_compaction: {
        type: 'boolean',
        label: '实时折叠已决思维链 (Thinking Compaction)',
        description: '在工具调用返回结果后，将冗长的 thinking 块折叠为轻量占位符 [Thinking folded]。',
        defaultValue: true,
        failSafeValue: false,
      },
      output_offload: {
        type: 'boolean',
        label: '超长工具输出物理落盘 (Large Output Offload)',
        description: '将超过 20KB 限制的工具执行结果自动转存到本地 .offloaded 临时目录中。',
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
    type: 'boolean',
    label: '启用自定义技能加载',
    description: '允许从项目本地加载特定的 Skill 定义，从而增强大模型在该技能领域的专业能力。',
    defaultValue: true,
    failSafeValue: true,
  },
  enable_global_skills: {
    type: 'boolean',
    label: '全局系统技能加载',
    description: '自动全局挂载系统内置的常用超能力技能。',
    defaultValue: true,
    failSafeValue: false,
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

