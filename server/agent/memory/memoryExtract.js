// server/agent/memory/memoryExtract.js
import { listMemoryFiles, writeMemoryFile } from './memoryStore.js';

const VALID_TYPES = new Set(['user', 'feedback', 'project', 'reference']);
const MIN_TEXT_MESSAGES = 2; // 消息太少时不提取

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

  if (textMessages.length < MIN_TEXT_MESSAGES) return;

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

    const items = JSON.parse(match[0]);
    if (!Array.isArray(items) || items.length === 0) return;

    for (const item of items) {
      if (!item.name || !item.description || !item.body) continue;
      const validType = VALID_TYPES.has(item.type) ? item.type : 'user';

      try {
        await writeMemoryFile(harnessId, item.name, validType, item.description, item.body);
        console.log(`[MemoryExtract] 写入记忆: ${item.name} (${validType})`);
      } catch (writeErr) {
        console.error(`[MemoryExtract] 写入记忆失败 "${item.name}":`, writeErr.message);
      }
    }
  } catch (err) {
    // 提取失败不影响主流程，静默降级
    console.error('[MemoryExtract] 提取失败，跳过:', err.message);
  }
}
