// server/agent/memory/memorySelect.js
import { listMemoryFiles, readMemoryFile } from './memoryStore.js';

const MAX_INJECT_COUNT = 5;
const MAX_INJECT_TOTAL_BYTES = 60 * 1024; // 60KB session budget（对齐 CC 约束）

/**
 * 用 LLM side-query 选出与当前对话最相关的记忆文件内容
 * 若 LLM 调用失败则降级到关键词匹配
 *
 * @param {Function} callLLM - executor._callLLMNonStream 的绑定函数，签名：(messages, systemPrompt) => Promise<string>
 * @param {string} harnessId
 * @param {Array} recentMessages - 最近几条消息（role + content）
 * @returns {Promise<string[]>} 选中的文件内容数组（已格式化，含标题）
 */
export async function selectAndLoadMemories(callLLM, harnessId, recentMessages) {
  const files = await listMemoryFiles(harnessId);
  if (files.length === 0) return [];

  // 构建记忆目录清单：序号: name — description
  const catalog = files
    .map((f, i) => `${i}: ${f.meta.name} — ${f.meta.description}`)
    .join('\n');

  // 提取最近对话文本，截取前 300 字符防止超长
  const recentText = recentMessages
    .slice(-6)
    .map(m => {
      const contentText = typeof m.content === 'string'
        ? m.content.slice(0, 300)
        : '[tool result]';
      return `${m.role}: ${contentText}`;
    })
    .join('\n');

  let selectedFilenames = [];

  // 尝试 LLM side-query
  try {
    const sysPrompt = '你是记忆选择助手。根据对话内容，从记忆目录中选出最相关的记忆（最多5条）。不确定就不选。只返回 JSON 整数数组，如 [0, 2]，不要其他内容。';
    const userMsg = `近期对话：\n${recentText}\n\n记忆目录：\n${catalog}`;

    const raw = await callLLM([{ role: 'user', content: userMsg }], sysPrompt);
    const match = raw.match(/\[[\d,\s]*\]/);
    if (match) {
      const indices = JSON.parse(match[0]);
      selectedFilenames = indices
        .filter(i => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < files.length)
        .slice(0, MAX_INJECT_COUNT)
        .map(i => files[i].filename);
    }
  } catch (err) {
    // 降级：关键词匹配（从最近对话中提取有效词，匹配 name+description）
    console.warn('[MemorySelect] LLM side-query 失败，降级到关键词匹配:', err.message);
    const keywords = recentText
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 3);

    selectedFilenames = files
      .filter(f => {
        const haystack = `${f.meta.name} ${f.meta.description}`.toLowerCase();
        return keywords.some(kw => haystack.includes(kw));
      })
      .slice(0, MAX_INJECT_COUNT)
      .map(f => f.filename);
  }

  if (selectedFilenames.length === 0) return [];

  // 读取选中文件内容，控制总字节预算
  const contents = [];
  let totalBytes = 0;

  for (const filename of selectedFilenames) {
    const f = files.find(x => x.filename === filename);
    if (!f) continue;

    const content = await readMemoryFile(f.filePath);
    const bytes = Buffer.byteLength(content, 'utf-8');

    if (totalBytes + bytes > MAX_INJECT_TOTAL_BYTES) break;

    contents.push(`### ${f.meta.name}\n${content}`);
    totalBytes += bytes;
  }

  return contents;
}
