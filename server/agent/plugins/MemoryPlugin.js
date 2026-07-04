// server/agent/plugins/MemoryPlugin.js
import { readIndex } from '../memory/memoryStore.js';
import { selectAndLoadMemories } from '../memory/memorySelect.js';
import { extractMemories } from '../memory/memoryExtract.js';
import { tryConsolidateMemories } from '../memory/memoryConsolidate.js';
import { appendSystemPromptSection } from '../promptAssembly/promptAssembly.js';

const MEMORY_CONTEXT_PATTERN = /(?:<memory_context>[\s\S]*?<\/memory_context>\s*)+/g;

function removeMemoryContext(value) {
  return String(value || '').replace(MEMORY_CONTEXT_PATTERN, '').trimStart();
}

export function stripPersistedMemoryContexts(messages) {
  let changed = false;
  for (const message of messages || []) {
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    const cleanContent = removeMemoryContext(message.content);
    if (cleanContent !== message.content) {
      message.content = cleanContent;
      changed = true;
    }
  }
  return changed;
}

export function stripApiMemoryContexts(apiMessages) {
  for (const message of apiMessages || []) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === 'text') block.text = removeMemoryContext(block.text);
    }
  }
}

export function injectMemoryContext(apiMessages, memoryContents) {
  if (!Array.isArray(memoryContents) || memoryContents.length === 0) return false;
  const memoryBlock =
    `<memory_context>\n以下是与本轮对话相关的长期记忆，请参考：\n\n${memoryContents.join('\n\n')}\n</memory_context>\n\n`;

  for (let i = apiMessages.length - 1; i >= 0; i--) {
    const message = apiMessages[i];
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    if (message.content.some(block => block.type === 'tool_result')) continue;
    const textBlock = message.content.find(block => block.type === 'text');
    if (!textBlock) continue;
    textBlock.text = memoryBlock + removeMemoryContext(textBlock.text);
    return true;
  }
  return false;
}

export function shouldDisableMemoryForTurn(executor) {
  return executor?.interactionMode?.mode === 'trace_inspection';
}

export function isStaticContextInspection(executor) {
  return executor?.dryRunMode === 'static_context';
}

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

    if (stripPersistedMemoryContexts(executor.messages)) {
      executor.onEvent('messages_update', { messages: executor.messages });
    }
    stripApiMemoryContexts(context.apiMessages);

    if (shouldDisableMemoryForTurn(executor)) return;

    // ① 将 MEMORY.md 索引注入 system prompt（不含具体内容，仅清单，利于缓存）
    try {
      const readIndexFn = executor.memoryDependencies?.readIndex || readIndex;
      const index = await readIndexFn(harnessId);
      if (index) {
        appendSystemPromptSection(context, {
          id: 'memory_index',
          label: 'Memory Index',
          target: 'system',
          lifecycle: 'pinned',
          source: `.memory/${harnessId}/MEMORY.md`,
          content: `<memory_index>\n以下是可用的长期记忆清单（具体内容已按需自动注入到本轮对话）：\n\n${index}\n</memory_index>`,
          order: 80,
          cacheImpact: 'stable_until_memory_index_changes',
        });
      }
    } catch (err) {
      console.error('[MemoryPlugin] 读取记忆索引失败:', err.message);
    }

    if (isStaticContextInspection(executor)) return;

    // ② LLM side-query 选相关记忆，注入到最后一条 user 消息开头
    try {
      const callLLM = executor._callLLMNonStream.bind(executor);
      const recentMessages = executor.messages.slice(-10);
      const selectAndLoadMemoriesFn = executor.memoryDependencies?.selectAndLoadMemories || selectAndLoadMemories;
      const memoryContents = await selectAndLoadMemoriesFn(callLLM, harnessId, recentMessages);

      if (memoryContents.length > 0) {
        injectMemoryContext(context.apiMessages, memoryContents);
      }
    } catch (err) {
      console.error('[MemoryPlugin] 记忆选择注入失败:', err.message);
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
    if (shouldDisableMemoryForTurn(executor)) return;

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
