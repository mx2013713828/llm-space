/**
 * messageBuilder.js — 后端 API 消息构建 + 上下文压缩纯函数
 *
 * 同步自前端，负责将内部消息格式转换为 Anthropic API 消息格式，
 * 以及在 Token 超标时进行智能压缩和 TODO 状态注入。
 */

/**
 * 组装 API 历史记录（严格保持顺序 + 智能块聚合 + 并行工具隔离）
 *
 * @param {Array} sourceMessages - 内部消息数组
 * @param {boolean} thinkingEnabled - 是否启用了思维链
 * @param {boolean} compactionEnabled - 是否启用了上下文压缩
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
  const shouldKeepThinking = (thinkingMsg, index) => {
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
      if (currentAssistantContent.length > 0) {
        apiMessages.push({ role: 'assistant', content: currentAssistantContent });
        currentAssistantContent = [];
      }
      if (currentToolResults.length > 0) {
        apiMessages.push({ role: 'user', content: currentToolResults });
        currentToolResults = [];
      }

      apiMessages.push({ role: 'user', content: [{ type: 'text', text: msg.content }] });
    } else if (msg.role === 'assistant') {
      if (msg.type !== 'tool_call' && currentToolResults.length > 0) {
        if (currentAssistantContent.length > 0) {
          apiMessages.push({ role: 'assistant', content: currentAssistantContent });
          currentAssistantContent = [];
        }
        apiMessages.push({ role: 'user', content: currentToolResults });
        currentToolResults = [];
      }

      if (msg.type === 'text') {
        currentAssistantContent.push({ type: 'text', text: msg.content });
      } else if (msg.type === 'thinking' && thinkingEnabled) {
        let thinkingContent = msg.content;
        if (compactionEnabled && !shouldKeepThinking(msg, idx)) {
          thinkingContent = '[Thinking folded]';
        }
        const b = { type: 'thinking', thinking: thinkingContent };
        if (msg.signature) b.signature = msg.signature;
        currentAssistantContent.push(b);
      } else if (msg.type === 'tool_call') {
        currentAssistantContent.push({ type: 'tool_use', id: msg.id, name: msg.toolName, input: msg.toolInput });
        if (msg.toolOutput != null) {
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

  if (currentAssistantContent.length > 0) {
    apiMessages.push({ role: 'assistant', content: currentAssistantContent });
  }
  if (currentToolResults.length > 0) {
    apiMessages.push({ role: 'user', content: currentToolResults });
  }

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
 * @param {boolean} compactionEnabled - 是否启用压缩
 * @returns {{ messages: Array, compactedCount: number, estimatedTokens: number|null }}
 */
export function compactMessages(messages, turnIndex, currentTokens, systemPrompt, tools, thinkingEnabled, compactionEnabled = true) {
  if (!compactionEnabled) {
    return { messages, compactedCount: 0, estimatedTokens: null };
  }

  if (currentTokens <= 160000 || turnIndex <= 5) {
    return { messages, compactedCount: 0, estimatedTokens: null };
  }

  console.log("🌊 触发 Soft Compact Epoch，开始压缩历史...");
  let compactedCount = 0;
  let compactedMessages = messages.map(msg => {
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
        const head = newMsg.toolOutput.slice(0, 1000);
        newMsg.toolOutput = `${head}\n\n...[已折叠旧的工具输出结果]...`;
        compactedCount++;
      }
    }
    return newMsg;
  });

  let estimatedTokens = null;

  if (compactedCount > 0) {
    compactedMessages = [
      ...compactedMessages,
      {
        role: 'system',
        type: 'system_alert',
        turn: turnIndex,
        content: `触发上下文软清洗 (Soft Compact Epoch)：成功对 ${compactedCount} 处历史冗余数据进行了折叠或重写，从而释放 Context 空间，最大化保护 Prompt Cache。`
      }
    ];
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
 * @returns {Array} 注入后的消息数组
 */
export function injectTodoState(apiMessages, todos, roundsSinceTodo) {
  const result = apiMessages.map(msg => ({ ...msg, content: [...msg.content] }));

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
