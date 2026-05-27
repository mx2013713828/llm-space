// server/agent/memory/memoryStore.js
import path from 'path';
import { promises as fs } from 'fs';

const MEMORY_ROOT = path.join(process.cwd(), '.memory');
const MAX_MEMORIES = 200;
const MAX_FILE_LINES = 200;
const MAX_FILE_BYTES = 4096;

// P0-1：写锁，防止 rebuildIndex 并发冲突
const writeLocks = new Map();
async function withWriteLock(harnessId, fn) {
  const prev = writeLocks.get(harnessId) ?? Promise.resolve();
  const next = prev.then(fn);
  writeLocks.set(harnessId, next.catch(() => {}));
  return next;
}

/** 获取某 harness 的记忆目录（含路径穿越防护）*/
export function getMemoryDir(harnessId) {
  // P0-2：harnessId 校验，防路径穿越
  if (!harnessId || typeof harnessId !== 'string') throw new Error('harnessId 不能为空');
  if (/[/\\.]/.test(harnessId)) throw new Error(`harnessId 含非法字符: ${harnessId}`);
  return path.join(MEMORY_ROOT, harnessId);
}

/** 安全地按字节截断 UTF-8 字符串，不破坏多字节字符（P1-3）*/
function truncateUtf8(str, maxBytes) {
  const buf = Buffer.from(str, 'utf-8');
  if (buf.length <= maxBytes) return str;
  let i = maxBytes;
  // 回退到多字节字符起始边界
  while (i > 0 && (buf[i] & 0xC0) === 0x80) i--;
  return buf.slice(0, i).toString('utf-8');
}

/** 解析 Markdown YAML frontmatter */
function parseFrontmatter(content) {
  const meta = { name: '', description: '', type: 'user' };
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (match) {
    match[1].split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx === -1) return;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim().replace(/^['"\s]|['"\s]$/g, '');
      if (key === 'name') meta.name = val;
      if (key === 'description') meta.description = val;
      if (key === 'type') meta.type = val;
    });
  }
  return meta;
}

/** 列举某 harness 的所有记忆文件，按 mtime 降序，最多 MAX_MEMORIES 个 */
export async function listMemoryFiles(harnessId) {
  const dir = getMemoryDir(harnessId);
  try {
    await fs.mkdir(dir, { recursive: true });
    const items = await fs.readdir(dir, { withFileTypes: true });
    const files = items.filter(
      item => item.isFile() && item.name.endsWith('.md') && item.name !== 'MEMORY.md'
    );

    // P2-6：对单文件失败单独 catch，跳过已删除或无法读取的文件
    const withStats = (await Promise.all(
      files.map(async item => {
        try {
          const filePath = path.join(dir, item.name);
          const [content, stat] = await Promise.all([
            fs.readFile(filePath, 'utf-8'),
            fs.stat(filePath)
          ]);
          const meta = parseFrontmatter(content);
          return { filename: item.name, filePath, content, meta, mtime: stat.mtime };
        } catch {
          return null; // 跳过已删除或无法读取的文件
        }
      })
    )).filter(Boolean);

    return withStats
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, MAX_MEMORIES);
  } catch {
    return [];
  }
}

/** 读取记忆文件内容，并裁剪到预算内 */
export async function readMemoryFile(filePath) {
  try {
    let content = await fs.readFile(filePath, 'utf-8');
    // 截断：最多 MAX_FILE_LINES 行
    const lines = content.split('\n').slice(0, MAX_FILE_LINES);
    content = lines.join('\n');
    // P1-3：UTF-8 安全截断到 MAX_FILE_BYTES 字节
    content = truncateUtf8(content, MAX_FILE_BYTES);
    return content;
  } catch {
    return '';
  }
}

/**
 * 写入一条记忆文件，并重建 MEMORY.md 索引
 * @param {string} harnessId
 * @param {string} name - slug 名称（小写连字符）
 * @param {'user'|'feedback'|'project'|'reference'} type
 * @param {string} description - 一行描述
 * @param {string} body - 记忆正文
 */
export async function writeMemoryFile(harnessId, name, type, description, body) {
  // P0-1：写锁串行化
  return withWriteLock(harnessId, async () => {
    const dir = getMemoryDir(harnessId);
    await fs.mkdir(dir, { recursive: true });

    const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    // P1-4：slug 为空时抛出错误
    if (!slug) throw new Error(`记忆名称无法生成有效 slug: "${name}"`);

    // P2-5：清洗 name/description 中的换行符，防止 frontmatter 破坏
    const safeName = name.replace(/[\r\n]/g, ' ').trim();
    const safeDesc = description.replace(/[\r\n]/g, ' ').trim().slice(0, 200);

    const filePath = path.join(dir, `${slug}.md`);
    const content = `---\nname: ${safeName}\ndescription: ${safeDesc}\ntype: ${type}\n---\n\n${body}\n`;
    await fs.writeFile(filePath, content, 'utf-8');

    await rebuildIndex(harnessId);
    return filePath;
  });
}

/** 删除记忆文件并重建索引 */
export async function deleteMemoryFile(harnessId, filename) {
  // P0-1：写锁串行化
  return withWriteLock(harnessId, async () => {
    const filePath = path.join(getMemoryDir(harnessId), filename);
    try {
      await fs.unlink(filePath);
    } catch { /* 忽略不存在 */ }
    await rebuildIndex(harnessId);
  });
}

/**
 * 重建 MEMORY.md 索引
 * 格式：- [name](filename.md) — description
 * 最多 200 行 / 25KB
 */
export async function rebuildIndex(harnessId) {
  const files = await listMemoryFiles(harnessId);
  const lines = files.map(f => `- [${f.meta.name}](${f.filename}) — ${f.meta.description}`);
  const content = lines.slice(0, 200).join('\n');
  const indexPath = path.join(getMemoryDir(harnessId), 'MEMORY.md');

  // P1-3：UTF-8 安全截断到 25KB
  const finalContent = truncateUtf8(content, 25600);
  await fs.writeFile(indexPath, finalContent, 'utf-8');
  return finalContent;
}

/** 读取 MEMORY.md 索引内容 */
export async function readIndex(harnessId) {
  const indexPath = path.join(getMemoryDir(harnessId), 'MEMORY.md');
  try {
    return await fs.readFile(indexPath, 'utf-8');
  } catch {
    return '';
  }
}
