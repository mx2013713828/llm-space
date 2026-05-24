/**
 * messageBuilder.js — API 消息构建 + 上下文压缩纯函数
 *
 * 从 TrajectoryPage.jsx 提取的零副作用逻辑，
 * 负责将内部消息格式转换为 Anthropic API 消息格式，
 * 以及在 Token 超标时进行智能压缩。
 */

/**
 * 组装 API 历史记录（严格保持顺序 + 智能块聚合 + 并行工具隔离）
 *
 * @param {Array} sourceMessages - 内部消息数组
 * @param {boolean} thinkingEnabled - 是否启用了思维链
 * @returns {Array} 符合 Anthropic API 规范的消息数组
 */
export function buildApiMessages(sourceMessages, thinkingEnabled, compactionEnabled = true) {
  const apiMessages = [];
  let currentAssistantContent = [];
  let currentToolResults = [];

  // 1. 扫描所有未决（Pending）的工具调用 ID（即发起了 tool_call 但尚未拿到 toolOutput 结果的）
  const pendingToolIds = new Set();
  sourceMessages.forEach(msg => {
    if (msg.type === 'tool_call' && msg.toolOutput == null) {
      pendingToolIds.add(msg.id);
    }
  });

  // 2. 辅助函数：判断某条 thinking 消息所对应的 tool_call 是否还在等待结果
  // 在同一个助理响应块中，thinking 紧随其后的 tool_calls，如果有任何一个在等待结果，就需要保留 thinking
  const shouldKeepThinking = (thinkingMsg, index) => {
    // 往后寻找，直到遇到 user 消息或者非同一个 turn 的助理消息
    for (let i = index + 1; i < sourceMessages.length; i++) {
      const nextMsg = sourceMessages[i];
      if (nextMsg.turn !== thinkingMsg.turn) break;
      if (nextMsg.role === 'user') break;
      if (nextMsg.type === 'tool_call' && pendingToolIds.has(nextMsg.id)) {
        return true;
      }
    }
    return false;
  };

  for (let idx = 0; idx < sourceMessages.length; idx++) {
    const msg = sourceMessages[idx];
    if (msg.role === 'user') {
      // Flush any pending assistant content and tool results first
      if (currentAssistantContent.length > 0) {
        apiMessages.push({ role: 'assistant', content: currentAssistantContent });
        currentAssistantContent = [];
      }
      if (currentToolResults.length > 0) {
        apiMessages.push({ role: 'user', content: currentToolResults });
        currentToolResults = [];
      }

      // Add the user message
      apiMessages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
    } else if (msg.role === 'assistant') {
      // 当我们遇到非工具调用的 assistant 块（如 text/thinking），且累积了上一阶段的工具结果时，
      // 说明已经进入了 ReAct 循环的下一个 Step，必须立刻将上一步的 assistant 消息和对应的 user tool_result 消息发送出去（Flush）。
      if (msg.type !== 'tool_call' && currentToolResults.length > 0) {
        if (currentAssistantContent.length > 0) {
          apiMessages.push({ role: 'assistant', content: currentAssistantContent });
          currentAssistantContent = [];
        }
        apiMessages.push({ role: 'user', content: currentToolResults });
        currentToolResults = [];
      }

      // 添加到当前的助手消息块中
      if (msg.type === 'text') {
        currentAssistantContent.push({ type: 'text', text: msg.content });
      } else if (msg.type === 'thinking' && thinkingEnabled) {
        let thinkingContent = msg.content;
        // 实时精准折叠：如果开启了压缩，且不是正在等待结果的工具周期内的 Thinking，立刻折叠为占位符
        if (compactionEnabled && !shouldKeepThinking(msg, idx)) {
          thinkingContent = '[Thinking folded]';
        }
        const b = { type: 'thinking', thinking: thinkingContent };
        if (msg.signature) b.signature = msg.signature;
        currentAssistantContent.push(b);
      } else if (msg.type === 'tool_call') {
        currentAssistantContent.push({ type: 'tool_use', id: msg.id, name: msg.toolName, input: msg.toolInput });
        if (msg.toolOutput != null) {
          // 阶段一：日常防护盾 (Always-On Shield) - 拦截超大文本（排除 read_file，确保当前轮次能读到完整源码）
          let outStr = String(msg.toolOutput);
          if (msg.toolName !== 'read_file' && outStr.length > 4000) {
            const head = outStr.slice(0, 1500);
            const tail = outStr.slice(-500);
            const truncatedCount = outStr.length - 2000;
            outStr = `${head}\n\n...[OUTPUT OFFLOADED - 截断了 ${truncatedCount} 个字符，如果需要中间的内容，请使用 grep 检索]...\n\n${tail}`;
          }
          currentToolResults.push({
            type: 'tool_result',
            tool_use_id: msg.id,
            content: outStr
          });
        }
      }
    }
  }

  // Flush 结尾残留的所有内容
  if (currentAssistantContent.length > 0) {
    apiMessages.push({ role: 'assistant', content: currentAssistantContent });
  }
  if (currentToolResults.length > 0) {
    apiMessages.push({ role: 'user', content: currentToolResults });
  }

  // 合并相邻 of 同角色消息（双重兜底防护）
  const collapsedMsgs = [];
  apiMessages.forEach(msg => {
    let last = collapsedMsgs[collapsedMsgs.length - 1];
    if (last && last.role === msg.role) {
      last.content.push(...msg.content);
    } else {
      collapsedMsgs.push(msg);
    }
  });

  return collapsedMsgs;
}

/**
 * 估算当前上下文的 Token 数
 *
 * @param {Array} messages - 内部消息数组
 * @param {boolean} thinkingEnabled - 是否启用了思维链
 * @param {string} systemPrompt - System Prompt 文本
 * @param {Array} tools - 工具配置数组
 * @param {number} contextTokens - API 返回的真实 Token 数（若 > 0 则优先使用）
 * @param {boolean} compactionEnabled - 是否启用了上下文压缩
 * @returns {number} 估算的 Token 数
 */
export function estimateTokens(messages, thinkingEnabled, systemPrompt, tools, contextTokens, compactionEnabled = true) {
  if (contextTokens > 0) return contextTokens;
  return Math.round((
    JSON.stringify(buildApiMessages(messages, thinkingEnabled, compactionEnabled)).length +
    (systemPrompt || '').length +
    JSON.stringify(tools || []).length
  ) / 4);
}

/**
 * 阶段二：80% 水位线软清洗 (Soft Compact Epoch)
 * 当 Token 超过阈值时，对旧历史中的冗余数据进行折叠或重写。
 *
 * @param {Array} messages - 当前消息数组
 * @param {number} turnIndex - 当前轮次
 * @param {number} currentTokens - 当前 Token 估算值
 * @param {string} systemPrompt - System Prompt
 * @param {Array} tools - 工具配置
 * @param {boolean} thinkingEnabled - 是否启用思维链
 * @returns {{ messages: Array, compactedCount: number, estimatedTokens: number|null }}
 */
export function compactMessages(messages, turnIndex, currentTokens, systemPrompt, tools, thinkingEnabled, compactionEnabled = true) {
  // 如果未启用压缩，直接返回
  if (!compactionEnabled) {
    return { messages, compactedCount: 0, estimatedTokens: null };
  }

  // 触发条件：Token 超过 160000 且至少聊了 5 轮以上
  if (currentTokens <= 160000 || turnIndex <= 5) {
    return { messages, compactedCount: 0, estimatedTokens: null };
  }

  console.log("🌊 触发 Soft Compact Epoch，开始压缩历史...");
  let compactedCount = 0;
  let compactedMessages = messages.map(msg => {
    // 只处理距离当前 > 5 轮的老消息
    if (turnIndex - (msg.turn || 1) <= 5) return msg;

    const newMsg = { ...msg };
    if (newMsg.type === 'tool_call') {
      if (newMsg.toolName === 'read_file' && newMsg.toolOutput) {
        newMsg.toolOutput = '[Archived: Content is on disk, re-read if necessary]';
        compactedCount++;
      } else if (newMsg.toolName === 'write_file' && newMsg.toolInput?.content) {
        newMsg.toolInput = { ...newMsg.toolInput, content: '[Content written to disk]' };
        newMsg.toolInputRaw = JSON.stringify(newMsg.toolInput);
        compactedCount++;
      } else if (['ls', 'grep', 'web_search', 'web_fetch'].includes(newMsg.toolName) && newMsg.toolOutput && newMsg.toolOutput.length > 2000) {
        // 机制 B：对旧的 ls/grep/web_search/web_fetch 输出，越过阈值（2000）则截断折叠
        const head = newMsg.toolOutput.slice(0, 1000);
        newMsg.toolOutput = `${head}\n\n...[已折叠旧的工具输出结果]...`;
        compactedCount++;
      }
    }
    return newMsg;
  });

  let estimatedTokens = null;

  if (compactedCount > 0) {
    // 向消息历史中追加一条 system_alert，以提供可视化的清洗通知
    compactedMessages = [
      ...compactedMessages,
      {
        role: 'system',
        type: 'system_alert',
        turn: turnIndex,
        content: `触发上下文软清洗 (Soft Compact Epoch)：成功对 ${compactedCount} 处历史冗余数据进行了折叠或重写，从而释放 Context 空间，最大化保护 Prompt Cache。`
      }
    ];
    // 就地重新估算压缩后的 Token 数
    estimatedTokens = Math.round((
      JSON.stringify(buildApiMessages(compactedMessages, thinkingEnabled, compactionEnabled)).length +
      (systemPrompt || '').length +
      JSON.stringify(tools || []).length
    ) / 4);
  }

  return { messages: compactedMessages, compactedCount, estimatedTokens };
}

/**
 * 将 TODO 看板状态注入到 API 消息末尾
 *
 * @param {Array} apiMessages - buildApiMessages 的输出
 * @param {Array} todos - TODO 列表
 * @param {number} roundsSinceTodo - 距离上次更新 TODO 的轮数
 * @returns {Array} 注入后的消息数组（不修改原数组）
 */
export function injectTodoState(apiMessages, todos, roundsSinceTodo) {
  const result = apiMessages.map(msg => ({ ...msg, content: [...msg.content] }));

  // 看板注入 (State Injection)
  if (todos && todos.length > 0) {
    const todoSummary = todos.map(t => {
      const marker = { pending: '[ ]', in_progress: '[>]', completed: '[x]', failed: '[!]' }[t.status] || '[ ]';
      return `${marker} ${t.content}`;
    }).join('\n');

    const stateBlock = {
      type: 'text',
      text: `\n<current_tasks_status>\n${todoSummary}\n</current_tasks_status>\n`
    };

    const lastMsg = result[result.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content.push(stateBlock);
    } else {
      result.push({ role: 'user', content: [stateBlock] });
    }
  }

  // 催促机制 (Nag Mechanism)
  if (roundsSinceTodo >= 3 && todos && todos.length > 0) {
    const nagBlock = {
      type: 'text',
      text: `\n<system_reminder>\n你已经连续 3 轮没有更新任务看板了。请在采取下一步行动前，务必使用 write_todos 工具同步当前的执行进度。\n</system_reminder>\n`
    };
    const lastMsg = result[result.length - 1];
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content.push(nagBlock);
    } else {
      result.push({ role: 'user', content: [nagBlock] });
    }
  }

  return result;
}

/**
 * 自动检测模型是否属于 Anthropic/Claude 模型系列
 *
 * @param {Object} modelConfig 模型配置信息
 * @returns {boolean}
 */
export function checkIfAnthropic(modelConfig) {
  if (!modelConfig) return false;
  const url = String(modelConfig.url || '').toLowerCase();
  const modelId = String(modelConfig.modelId || '').toLowerCase();
  const name = String(modelConfig.name || '').toLowerCase();

  if (url.includes('anthropic.com')) return true;
  if (modelId.includes('claude')) return true;
  if (name.includes('claude')) return true;

  return false;
}

/**
 * 对 System Prompt 进行结构拆分，提取动态信息（如今天的时间或知识库截止设定）后置
 *
 * @param {string} systemPrompt 原始 System Prompt 文本
 * @returns {{ staticSystem: string, dynamicSystem: string }}
 */
export function separateSystemPrompt(systemPrompt) {
  if (!systemPrompt) return { staticSystem: '', dynamicSystem: '' };

  const dynamicBlocks = [];
  let cleanedSystem = systemPrompt;

  // 1. 提取带 XML 标记的动态块
  const xmlTags = ['knowledge-cut-off', 'current_time', 'current_directory', 'dynamic_context'];
  xmlTags.forEach(tag => {
    const regex = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'g');
    let match;
    while ((match = regex.exec(systemPrompt)) !== null) {
      dynamicBlocks.push(match[0].trim());
    }
    cleanedSystem = cleanedSystem.replace(regex, '');
  });

  // 2. 提取不带 XML 标记但具有典型时间/环境特征的单行信息
  const lines = cleanedSystem.split('\n');
  const staticLines = [];
  const dynamicLines = [];

  const dynamicPatterns = [
    /today\s+is\s+/i,
    /current\s+time\s+is/i,
    /current\s+date\s+is/i,
    /current\s+directory\s+is/i,
    /current\s+workspace\s+is/i,
    /current\s+git\s+branch\s+is/i
  ];

  lines.forEach(line => {
    const isDynamic = dynamicPatterns.some(pattern => pattern.test(line));
    if (isDynamic) {
      dynamicLines.push(line.trim());
    } else {
      staticLines.push(line);
    }
  });

  cleanedSystem = staticLines.join('\n');

  const allDynamic = [
    ...dynamicBlocks,
    ...dynamicLines
  ].filter(Boolean).join('\n\n');

  return {
    staticSystem: cleanedSystem.replace(/\n{3,}/g, '\n\n').trim(),
    dynamicSystem: allDynamic.trim()
  };
}

/**
 * 核心对齐处理函数 (普适型接口，所有模型通用，cache_control 仅对 Anthropic 生效)
 *
 * @param {string} systemPrompt 原始 System Prompt
 * @param {Array} tools 原始 Tools 数组 (API 标准 Schema 格式)
 * @param {Array} apiMessages 已经过 buildApiMessages 与看板注入的最终 messages 数组
 * @param {Object} modelConfig 模型配置
 * @param {Array} skills 启用的技能 ID 列表
 * @returns {{ system: string|Array, tools: Array, messages: Array }} 转换后的大模型请求 payload
 */
export function alignRequestPayload(systemPrompt, tools, apiMessages, modelConfig, skills = []) {
  const isAnthropic = checkIfAnthropic(modelConfig);

  // 1. Tools 列表进行字母排序 (按 name 排序对齐)
  let alignedTools = [];
  if (tools && tools.length > 0) {
    alignedTools = tools.map(t => ({ ...t }));
    alignedTools.sort((a, b) => a.name.localeCompare(b.name));
  }

  // 2. System Prompt 动静重排与 Skills 动态目录注入
  const { staticSystem, dynamicSystem } = separateSystemPrompt(systemPrompt);
  let finalSystemText = staticSystem;

  if (skills && skills.length > 0) {
    const skillsPrompt = `\n\n<available_skills>\nThe following professional skills (Skills) are available in the current session. If you need to perform complex tasks related to these skills, you must use the \`read_file\` tool to read the corresponding \`SKILL.md\` guide to acquire precise domain knowledge and constraints:\n\n${skills.map(s => {
      // Compatible with legacy pure string IDs
      const skillId = typeof s === 'string' ? s : s.id;
      const skillFilePath = typeof s === 'string' ? `skills/${s}/SKILL.md` : s.file;
      const description = typeof s === 'string' ? 'Professional skill description' : (s.description || s.desc || 'Professional skill description');
      
      return `- **${skillId}** (read \`${skillFilePath}\` to activate): ${description}`;
    }).join('\n')}\n</available_skills>`;
    finalSystemText += skillsPrompt;
  }

  if (dynamicSystem) {
    finalSystemText += `\n\n<dynamic_context>\n${dynamicSystem}\n</dynamic_context>`;
  }

  // 3. 浅拷贝 apiMessages 以免直接 Mutation 影响外部原始数据
  let alignedMessages = (apiMessages || []).map(msg => ({
    ...msg,
    content: Array.isArray(msg.content) ? msg.content.map(c => ({ ...c })) : msg.content
  }));

  // 4. 为 Anthropic 模型动态注入 cache_control
  if (isAnthropic) {
    // A. 注入 System 缓存锚点
    let systemPayload = [];
    if (finalSystemText) {
      systemPayload = [
        {
          type: 'text',
          text: finalSystemText,
          cache_control: { type: 'ephemeral' }
        }
      ];
    }

    // B. 注入 Tools 最后一个工具的缓存锚点
    if (alignedTools.length > 0) {
      alignedTools[alignedTools.length - 1] = {
        ...alignedTools[alignedTools.length - 1],
        cache_control: { type: 'ephemeral' }
      };
    }

    // C. 注入 Messages 缓存锚点 (通常放在倒数第 3 条，即倒数第二次的 User/Tool 返回上)
    if (alignedMessages.length >= 3) {
      const targetIdx = alignedMessages.length - 3;
      alignedMessages = alignedMessages.map((msg, idx) => {
        if (idx === targetIdx) {
          const newContent = msg.content.map((block, bIdx) => {
            if (bIdx === msg.content.length - 1) {
              return { ...block, cache_control: { type: 'ephemeral' } };
            }
            return block;
          });
          return { ...msg, content: newContent };
        }
        return msg;
      });
    }

    return {
      system: systemPayload,
      tools: alignedTools,
      messages: alignedMessages
    };
  }

  // 5. 针对非 Anthropic 模型 (DeepSeek/Gemini 等)，仅提供排序与动静分离的头部优化，避免 cache_control 引起校验报错
  return {
    system: finalSystemText,
    tools: alignedTools,
    messages: alignedMessages
  };
}

