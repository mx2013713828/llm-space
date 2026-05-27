// server/agent/plugins/MemoryPlugin.js
import { readIndex } from '../memory/memoryStore.js';
import { selectAndLoadMemories } from '../memory/memorySelect.js';
import { extractMemories } from '../memory/memoryExtract.js';
import { tryConsolidateMemories } from '../memory/memoryConsolidate.js';

export const MemoryPlugin = {
  name: 'MemoryPlugin',

  /**
   * preLLM：将记忆注入上下文
   *
   * Prompt Cache 保护策略（关键）：
   * ① MEMORY.md 索引 → 追加到 context.systemPrompt 末尾
   *   - 内容相对稳定（只有记忆增删时才变），有利于 prompt cache 命中
   * ② 具体记忆内容 → 注入到最后一条 user 消息的开头
   *   - user turn 不在 cache 中，可自由变化，不破坏 system prompt 的 cache 前缀
   */
  async preLLM(context) {
    const { executor } = context;
    const memFeature = executor.features?.enable_memory;
    if (!memFeature?.enabled) return;

    const harnessId = executor.harnessId;
    if (!harnessId) return;

    // ① 将 MEMORY.md 索引注入 system prompt（不含具体内容，仅清单，利于缓存）
    try {
      const index = await readIndex(harnessId);
      if (index) {
        context.systemPrompt +=
          `\n\n<memory_index>\n以下是可用的长期记忆清单（具体内容已按需自动注入到本轮对话）：\n\n${index}\n</memory_index>`;
      }
    } catch (err) {
      console.error('[MemoryPlugin] 读取记忆索引失败:', err.message);
    }

    // ② LLM side-query 选相关记忆，注入到最后一条 user 消息开头
    try {
      const callLLM = executor._callLLMNonStream.bind(executor);
      const recentMessages = executor.messages.slice(-10);
      const memoryContents = await selectAndLoadMemories(callLLM, harnessId, recentMessages);

      if (memoryContents.length > 0) {
        const memoryBlock =
          `<memory_context>\n以下是与本轮对话相关的长期记忆，请参考：\n\n${memoryContents.join('\n\n')}\n</memory_context>\n\n`;

        // 找到 messages 中最后一条 user 消息，在其内容开头注入
        // 注意：这里修改的是 executor.messages（内存中的原始消息），
        // 而非 context.apiMessages（已构建的 API 消息），确保注入生效
        const msgs = executor.messages;
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user' && typeof msgs[i].content === 'string') {
            msgs[i] = { ...msgs[i], content: memoryBlock + msgs[i].content };
            break;
          }
        }
      }
    } catch (err) {
      console.error('[MemoryPlugin] 记忆选择注入失败:', err.message);
    }

    // 记忆注入完成后，重新构建 apiMessages（因为 messages 已修改）
    // context.apiMessages 会在 _callLLM 中使用，需要从最新 executor.messages 构建
    // 由于 AgentExecutor 在 preLLM 之后使用 context.apiMessages 发起请求，
    // 我们需要同步更新 context.apiMessages
    try {
      const { buildApiMessages } = await import('../messageBuilder.js');
      context.apiMessages = buildApiMessages(
        executor.messages,
        executor.thinkingEnabled,
        executor.features.context_compaction
      );
    } catch (err) {
      console.error('[MemoryPlugin] 重建 apiMessages 失败:', err.message);
    }
  },

  /**
   * onLoopEnd：对话结束后 fire-and-forget 提取记忆（并可选整理）
   * 只在模型输出文字回复（非工具调用循环中）时触发
   */
  async onLoopEnd(context) {
    const { executor } = context;
    const memFeature = executor.features?.enable_memory;
    if (!memFeature?.enabled) return;

    const harnessId = executor.harnessId;
    if (!harnessId) return;

    // 判断是否为文字回复结束（对话告一段落）
    // 排除工具调用轮（此时最后一条消息是 tool_call 或 tool_result）
    const msgs = executor.messages;
    const lastMsg = msgs[msgs.length - 1];
    const isTextEnd = lastMsg?.role === 'assistant' && lastMsg?.type === 'text';
    if (!isTextEnd) return;

    // fire-and-forget：不 await，不阻塞主流程（SSE 已经发送完毕）
    const callLLM = executor._callLLMNonStream.bind(executor);
    const messageSnapshot = [...msgs]; // 快照防止异步期间被修改

    ;(async () => {
      try {
        // 仅在 memory_extract 子开关开启时提取
        if (memFeature.memory_extract !== false) {
          await extractMemories(callLLM, harnessId, messageSnapshot);
        }

        // 仅在 memory_consolidate 子开关开启时整理
        if (memFeature.memory_consolidate) {
          await tryConsolidateMemories(callLLM, harnessId);
        }
      } catch (err) {
        console.error('[MemoryPlugin] onLoopEnd 异步任务失败:', err.message);
      }
    })();
  }
};
