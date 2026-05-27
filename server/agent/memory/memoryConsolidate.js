// server/agent/memory/memoryConsolidate.js
import path from 'path';
import { promises as fs } from 'fs';
import {
  listMemoryFiles,
  writeMemoryFile,
  deleteMemoryFile,
  getMemoryDir
} from './memoryStore.js';

const CONSOLIDATE_THRESHOLD = 10;          // 触发整理的最低文件数
const CONSOLIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 小时间隔
const LOCK_EXPIRY_MS = 60 * 60 * 1000;    // 锁文件 1 小时后自动过期（崩溃恢复）
const VALID_TYPES = new Set(['user', 'feedback', 'project', 'reference']);

/**
 * 尝试整理记忆：去重、合并矛盾、淘汰过时
 *
 * 简化三层门控：
 * ① 文件数 >= CONSOLIDATE_THRESHOLD
 * ② 距上次整理 >= 24h（用 .consolidate-lock 的 mtime 记录）
 * ③ 无其他进程持锁（锁文件未过期）
 *
 * @param {Function} callLLM - executor._callLLMNonStream 绑定函数
 * @param {string} harnessId
 */
export async function tryConsolidateMemories(callLLM, harnessId) {
  const dir = getMemoryDir(harnessId);
  const lockPath = path.join(dir, '.consolidate-lock');

  // 门控 ①：文件数量
  const files = await listMemoryFiles(harnessId);
  if (files.length < CONSOLIDATE_THRESHOLD) return;

  // 门控 ② + ③：检查锁文件
  try {
    const stat = await fs.stat(lockPath);
    const age = Date.now() - stat.mtime.getTime();

    if (age < LOCK_EXPIRY_MS) {
      // 锁未过期：上次整理还在 1h 内（正在进行或刚完成）
      // 但如果上次整理时间不超过 24h，也跳过
      if (age < CONSOLIDATE_INTERVAL_MS) {
        console.log(`[MemoryConsolidate] 距上次整理仅 ${Math.round(age / 60000)} 分钟，跳过`);
        return;
      }
    }
    // 锁已过期（超过 1h），允许重新整理
  } catch {
    // 锁文件不存在，首次整理，继续
  }

  // 获取锁（写入当前时间戳）
  await fs.writeFile(lockPath, Date.now().toString(), 'utf-8');

  try {
    // 构建全量记忆内容，发给 LLM 整理
    const allContent = files
      .map(f => `### ${f.meta.name} (类型: ${f.meta.type})\n描述：${f.meta.description}\n\n${f.content}`)
      .join('\n\n---\n\n');

    const sysPrompt = `你是记忆整理助手。对给定的记忆列表进行整理：
1. 合并重复或高度相似的记忆
2. 解决矛盾（保留较新、较具体的信息）
3. 淘汰已过时或价值极低的记忆
4. 返回整理后的 JSON 数组，格式：[{"name":"slug-name","type":"user|feedback|project|reference","description":"一行描述","body":"正文"}]
5. name 只用小写字母、数字和连字符
6. 只保留真正有长期价值的记忆`;

    const raw = await callLLM(
      [{ role: 'user', content: `待整理的记忆（共 ${files.length} 条）：\n\n${allContent}` }],
      sysPrompt
    );

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('[MemoryConsolidate] LLM 未返回有效 JSON 数组，跳过整理');
      return;
    }

    const consolidated = JSON.parse(match[0]);
    if (!Array.isArray(consolidated) || consolidated.length === 0) {
      console.warn('[MemoryConsolidate] 整理结果为空，跳过写入');
      return;
    }

    // 删除所有旧记忆
    for (const f of files) {
      await deleteMemoryFile(harnessId, f.filename);
    }

    // 写入整理后的记忆
    let written = 0;
    for (const item of consolidated) {
      if (!item.name || !item.description || !item.body) continue;
      const validType = VALID_TYPES.has(item.type) ? item.type : 'user';
      try {
        await writeMemoryFile(harnessId, item.name, validType, item.description, item.body);
        written++;
      } catch (err) {
        console.error(`[MemoryConsolidate] 写入失败 "${item.name}":`, err.message);
      }
    }

    console.log(`[MemoryConsolidate] harnessId=${harnessId} 整理完成，${files.length} → ${written} 条`);
  } catch (err) {
    console.error('[MemoryConsolidate] 整理失败:', err.message);
  } finally {
    // 更新锁文件 mtime 记录整理完成时间（无论成败）
    await fs.writeFile(lockPath, Date.now().toString(), 'utf-8').catch(() => {});
  }
}
