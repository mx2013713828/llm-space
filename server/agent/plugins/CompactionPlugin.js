import path from 'path';
import { promises as fs } from 'fs';
import { compactMessages, buildApiMessages } from '../messageBuilder.js';
import { COMPACT_PROMPT } from '../compactPrompt.js';
import { HARD_COMPACT_TOKEN_THRESHOLD } from '../AgentExecutor.js';

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
        console.log(`🌊 触发 Hard-Compact 全量语义总结，当前 Token 估算：${tokensAfterSoft}...`);

        executor.messages.push({
          role: 'system',
          type: 'system_alert',
          turn: turnIndex,
          content: '⚠️ 上下文即将溢出！正在使用大模型生成历史战局摘要并重建记忆...'
        });
        executor.onEvent('messages_update', { messages: executor.messages });

        const transcriptsDir = path.join(process.cwd(), '.transcripts');
        await fs.mkdir(transcriptsDir, { recursive: true });
        const transcriptFile = path.join(transcriptsDir, `transcript-${Date.now()}-${turnIndex}.jsonl`);
        const jsonlData = executor.messages.map(m => JSON.stringify(m)).join('\n');
        await fs.writeFile(transcriptFile, jsonlData, 'utf-8');

        const messagesToSummarize = executor.messages.filter(m => m.type !== 'system_alert');
        const summaryMessages = buildApiMessages(messagesToSummarize, false, false);

        const summaryRaw = await executor._callLLMNonStream(summaryMessages, COMPACT_PROMPT);
        
        let summary = summaryRaw;
        summary = summary.replace(/<analysis>[\s\S]*?(?:<\/analysis>|$)/gi, '').trim();
        const summaryMatch = /<summary>([\s\S]*?)<\/summary>/i.exec(summary);
        if (summaryMatch) {
          summary = summaryMatch[1].trim();
        } else {
          summary = summary.replace(/<\/?summary>/gi, '').trim();
        }

        console.log('✅ Hard-Compact 语义摘要生成成功，长度为:', summary.length);

        const activeMessages = executor.messages.filter(msg => turnIndex - (msg.turn || 1) < 3);

        const summaryMsg = {
          role: 'user',
          type: 'system_alert',
          turn: turnIndex,
          content: `[System Memory Compacted]\nHere is the summarized history of the project so far:\n\n${summary}\n\nThe complete historical transcript has been persisted to disk.`
        };

        const resumeMsg = {
          role: 'user',
          type: 'system_alert',
          turn: turnIndex,
          content: `Please continue the conversation from where we left it off without asking the user any further questions. Continue with the last task that you were asked to work on.`
        };

        // 更新 executor 的消息并重置状态
        executor.messages.splice(0, executor.messages.length, summaryMsg, ...activeMessages, resumeMsg);
        executor.contextTokens = 0;
        executor.hardCompactTriggered = true;

        executor.onEvent('messages_update', { messages: executor.messages });
        await executor.saveSession();
      } catch (compactErr) {
        console.error('[CompactionPlugin] Failed to perform Hard-Compact:', compactErr);
      }
    }
  }
};
