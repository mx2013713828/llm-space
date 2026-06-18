import path from 'path';
import { promises as fs } from 'fs';
import { compactMessages, buildApiMessages } from '../messageBuilder.js';
import { COMPACT_PROMPT } from '../compactPrompt.js';
import { HARD_COMPACT_TOKEN_THRESHOLD } from '../AgentExecutor.js';

export function foldThinkingForDisplay(executor) {
  if (!executor.features?.context_compaction?.thinking_compaction) return false;
  let changed = false;
  for (const message of executor.messages) {
    if (message.type === 'thinking' && !message.folded) {
      message.folded = true;
      changed = true;
    }
  }
  if (changed) executor.onEvent('messages_update', { messages: executor.messages });
  return changed;
}

export const CompactionPlugin = {
  name: 'CompactionPlugin',

  async preLLM(context) {
    const { executor, turnIndex } = context;

    // 获取可配置的参数入口，提供默认值
    const cooldown = executor.features?.soft_compact_cooldown ?? 10;
    const minSaving = executor.features?.soft_compact_min_saving ?? 10000;

    let shouldTrySoft = true;
    if (executor.lastSoftCompactTurn !== undefined && (turnIndex - executor.lastSoftCompactTurn) < cooldown) {
      shouldTrySoft = false;
      console.log(`[CompactionPlugin] 距离上次软清洗不到 ${cooldown} 轮 (当前: ${turnIndex}, 上次: ${executor.lastSoftCompactTurn})，跳过软清洗。`);
    }

    if (!executor.features?.context_compaction?.soft_compact) {
      shouldTrySoft = false;
    }

    if (shouldTrySoft) {
      // 1. Soft Compact Epoch
      const compactResult = compactMessages(
        executor.messages,
        turnIndex,
        executor.estimateCurrentTokens(),
        executor.systemPrompt,
        executor.tools,
        executor.thinkingEnabled,
        executor.compactionEnabled,
        minSaving
      );

      if (compactResult.compactedCount > 0) {
        // 记录实际发生 soft-compact 的轮次
        executor.lastSoftCompactTurn = turnIndex;

        // 通过直接更新 executor 属性使改变生效
        executor.messages.splice(0, executor.messages.length, ...compactResult.messages);
        if (compactResult.estimatedTokens != null) {
          executor.contextTokens = compactResult.estimatedTokens;
        }
        executor.onEvent('messages_update', { messages: executor.messages });
        await executor.saveSession();
      }
    }

    // 2. Hard Compact Stage 2
    const tokensAfterSoft = executor.contextTokens > 0 ? executor.contextTokens : executor.estimateCurrentTokens();
    if (executor.compactionEnabled && executor.features?.context_compaction?.hard_compact && tokensAfterSoft > HARD_COMPACT_TOKEN_THRESHOLD && !executor.hardCompactTriggered && executor.messages.length > 10) {
      try {
        await executor.performHardCompact(turnIndex);
      } catch (compactErr) {
        console.error('[CompactionPlugin] Failed to perform Hard-Compact:', compactErr);
      }
    }
  },

  async postToolUse({ executor }) {
    foldThinkingForDisplay(executor);
  },

  async onLoopEnd({ executor }) {
    foldThinkingForDisplay(executor);
  }
};
