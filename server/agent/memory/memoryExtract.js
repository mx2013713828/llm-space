// server/agent/memory/memoryExtract.js
import { listMemoryFiles, writeMemoryFile } from './memoryStore.js';
import { createMemoryCandidate } from './memoryCandidateStore.js';
import { classifyMemoryItem, summarizeMemoryRouting } from './memoryQualityGate.js';

const VALID_TYPES = new Set(['user', 'feedback', 'project', 'reference']);
const MIN_TEXT_MESSAGES = 2; // 消息太少时不提取
const MAX_EXTRACTED_ITEMS_PER_RUN = 2;
const TRANSIENT_MEMORY_PATTERNS = [
  /teammate|checker|审查报告|P0|P1|P2|当前任务|这次|本轮|执行轨迹/i,
];

function isTransientMemoryItem(item) {
  const text = `${item?.name || ''}\n${item?.description || ''}\n${item?.body || ''}`;
  return TRANSIENT_MEMORY_PATTERNS.some(pattern => pattern.test(text));
}

export function filterMemoryExtractionItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(item => item?.name && item?.description && item?.body)
    .filter(item => !isTransientMemoryItem(item))
    .slice(0, MAX_EXTRACTED_ITEMS_PER_RUN);
}

function normalizeExtractionItems(items) {
  if (!Array.isArray(items)) return [];

  return items
    .filter(item => item?.name && item?.description && item?.body)
    .slice(0, 12);
}

function hasExplicitMemoryRequest(messages = []) {
  return messages.some(message => (
    message.role === 'user' &&
    /(请)?记住|记下|保存为记忆|remember this|please remember/i.test(String(message.content || ''))
  ));
}

function emptyRoutingSummary() {
  return summarizeMemoryRouting([]);
}

/**
 * 从最近对话中提取用户偏好、项目事实，写入记忆文件
 * 只在对话真正告一段落时调用（stop_reason !== 'tool_use'）
 *
 * @param {Function} callLLM - executor._callLLMNonStream 绑定函数
 * @param {string} harnessId
 * @param {Array} messages - 当前完整消息列表
 */
export async function extractMemories(callLLM, harnessId, messages) {
  // 只取最近 10 条文字消息（排除工具调用、system_alert 等）
  const textMessages = messages.filter(
    m => (m.type === 'text' || m.role === 'user') && m.type !== 'system_alert'
  ).slice(-10);

  if (textMessages.length < MIN_TEXT_MESSAGES) return emptyRoutingSummary();

  const dialogue = textMessages
    .map(m => `${m.role}: ${String(m.content || '').slice(0, 500)}`)
    .join('\n');

  // 构建已有记忆摘要，避免重复写入
  const existingFiles = await listMemoryFiles(harnessId);
  const existing = existingFiles.length > 0
    ? existingFiles.map(f => `- ${f.meta.name}: ${f.meta.description}`).join('\n')
    : '（无已有记忆）';

  const sysPrompt = `你是记忆提取助手。从对话中提取用户偏好、工作习惯、项目事实等跨会话有价值的信息。

规则：
1. 只提取真正稳定、跨会话仍有价值的信息（如编码偏好、项目约定、用户习惯）
2. 临时性内容（如"这次帮我做X"）不提取
3. 如果已有记忆已完全覆盖，返回空数组 []
4. 返回 JSON 数组，每项格式：{"name":"slug-name","type":"user|feedback|project|reference","description":"一行描述（不含换行）","body":"详细内容"}
5. name 只用小写字母、数字和连字符
6. 若无新信息，返回 []`;

  const userMsg = `已有记忆：\n${existing}\n\n近期对话：\n${dialogue}`;

  try {
    const raw = await callLLM([{ role: 'user', content: userMsg }], sysPrompt);

    // 提取 JSON 数组（允许 LLM 在数组前后有说明文字）
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return;

    const items = normalizeExtractionItems(JSON.parse(match[0]));
    if (items.length === 0) return emptyRoutingSummary();

    const routingResults = [];
    const explicitMemoryRequest = hasExplicitMemoryRequest(textMessages);
    for (const item of items) {
      const validType = VALID_TYPES.has(item.type) ? item.type : 'user';
      const normalizedItem = { ...item, type: validType };
      const routing = classifyMemoryItem(normalizedItem, {
        explicitMemoryRequest,
        source: { kind: 'conversation' },
      });
      routingResults.push(routing);

      if (routing.decision === 'auto_write') {
        try {
          await writeMemoryFile(harnessId, normalizedItem.name, validType, normalizedItem.description, normalizedItem.body);
          console.log(`[MemoryExtract] 写入记忆: ${normalizedItem.name} (${validType})`);
        } catch (writeErr) {
          console.error(`[MemoryExtract] 写入记忆失败 "${normalizedItem.name}":`, writeErr.message);
        }
      } else if (routing.decision === 'pending_review') {
        try {
          await createMemoryCandidate({
            harnessId,
            item: normalizedItem,
            source: { kind: 'conversation' },
            reason: routing.reason,
            confidence: routing.confidence,
            risk: routing.risk,
          });
          console.log(`[MemoryExtract] 候选记忆: ${normalizedItem.name} (${validType})`);
        } catch (candidateErr) {
          console.error(`[MemoryExtract] 写入候选记忆失败 "${normalizedItem.name}":`, candidateErr.message);
        }
      }
    }

    const summary = summarizeMemoryRouting(routingResults);
    console.log(`[MemoryExtract] 路由结果: auto_write=${summary.auto_write}, pending_review=${summary.pending_review}, discard=${summary.discard}, sensitive_blocked=${summary.sensitive_blocked}`);
    return summary;
  } catch (err) {
    // 提取失败不影响主流程，静默降级
    console.error('[MemoryExtract] 提取失败，跳过:', err.message);
    return emptyRoutingSummary();
  }
}
