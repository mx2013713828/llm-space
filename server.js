/**
 * LLM Space - 本地代理服务器
 * 转发请求到 Anthropic 兼容 API，解决浏览器 CORS 限制
 * 支持 SSE 流式输出、extended thinking、工具调用
 */
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

import { createActiveJobRegistry } from './server/agent/activeJobs.js';
import { cronScheduler } from './server/agent/scheduler/cronScheduler.js';
import { startCronQueueProcessor } from './server/agent/scheduler/cronRunner.js';
import { createCronApiHandlers } from './server/agent/scheduler/cronApi.js';
import { listExecutionStrategies } from './server/agent/strategies/strategyRegistry.js';
import { loadSubAgentTrace } from './server/agent/subagents/subAgentTraceStore.js';
import { loadTeammateTrace } from './server/agent/teams/teammateTraceStore.js';
import { createServerApp } from './server/app/createServerApp.js';
import { handleLegacyChatRoute } from './server/legacyChatRoute.js';
import { parseModelsConfig } from './server/modelConfig.js';
import { broadcastEvent as broadcastAgentEvent } from './server/routes/agentRunRoutes.js';
import { findSafeHarnessPath } from './server/routes/harnessRoutes.js';
import { getToolSchemas } from './server/tools/index.js';

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';
const HARNESS_DIR = path.join(process.cwd(), 'harnesses');
const SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');
const SKILLS_DIR = path.join(process.cwd(), 'skills');
const dotEnvPath = path.join(process.cwd(), '.env');

// 加载 .env 文件到 process.env
try {
  const envContent = await fs.readFile(dotEnvPath, 'utf-8');
  const modelsConfig = parseModelsConfig(envContent);
  if (modelsConfig.length > 0 && !process.env.MODELS_CONFIG) {
    process.env.MODELS_CONFIG = JSON.stringify(modelsConfig);
  }
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (key === 'MODELS_CONFIG') continue;
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
  console.log('  ✅ .env 已加载');
} catch {
  console.log('  ⚠️  .env 文件未找到，跳过');
}

// Node.js fetch 不自动读取 HTTPS_PROXY，用 EnvHttpProxyAgent 全局适配
setGlobalDispatcher(new EnvHttpProxyAgent());
console.log('  🔁 代理 agent 已全局启用（自动检测 HTTPS_PROXY / NO_PROXY）');

// 确保 .offloaded/ 被加入 .gitignore
async function ensureOffloadedGitignored() {
  try {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    if (!content.includes('.offloaded/') && !content.includes('.offloaded')) {
      const separator = content.endsWith('\n') || content === '' ? '' : '\n';
      const newContent = `${content}${separator}.offloaded/\n`;
      await fs.writeFile(gitignorePath, newContent, 'utf-8');
      console.log('  ✅ 已自动向 .gitignore 追加 .offloaded/');
    }
  } catch (err) {
    console.error('  ⚠️ 确保 .gitignore 包含 .offloaded/ 时发生错误:', err);
  }
}

/** 辅助函数：解析 Markdown 的 YAML frontmatter */
function parseFrontmatter(content) {
  const meta = { name: '', description: '' };
  const match = content.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  if (match) {
    const yamlText = match[1];
    yamlText.split('\n').forEach(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let val = parts.slice(1).join(':').trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1).trim();
        }
        if (key === 'name') meta.name = val;
        if (key === 'description') meta.description = val;
      }
    });
  }
  return meta;
}

/** 递归扫描子目录下的全部文件物理路径 */
async function scanSubDirFiles(dirPath) {
  const files = [];
  try {
    const items = await fs.readdir(dirPath, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dirPath, item.name);
      if (item.isDirectory()) {
        const subFiles = await scanSubDirFiles(fullPath);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }
  } catch (_) {
    // 忽略目录不存在等异常
  }
  return files;
}

function registerExtraRoutes(app) {
  /** 获取某 harness 的记忆文件清单 */
  app.get('/api/memory/:harnessId', async (req, res) => {
    try {
      const { listMemoryFiles } = await import('./server/agent/memory/memoryStore.js');
      const files = await listMemoryFiles(req.params.harnessId);
      res.json(files.map(f => ({
        filename: f.filename,
        name: f.meta.name,
        type: f.meta.type,
        description: f.meta.description,
        mtime: f.mtime,
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 删除某条记忆文件 */
  app.delete('/api/memory/:harnessId/:filename', async (req, res) => {
    try {
      const { deleteMemoryFile } = await import('./server/agent/memory/memoryStore.js');
      await deleteMemoryFile(req.params.harnessId, req.params.filename);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 获取所有 Skill 元数据 */
  app.get('/api/skills', async (req, res) => {
    try {
      const includeGlobal = req.query.global === 'true';

      await fs.mkdir(SKILLS_DIR, { recursive: true });
      const localItems = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
      const localSkills = [];

      for (const item of localItems) {
        if (!item.isDirectory()) continue;
        const skillId = item.name;
        const skillDir = path.join(SKILLS_DIR, skillId);
        const skillMdPath = path.join(skillDir, 'SKILL.md');

        try {
          const content = await fs.readFile(skillMdPath, 'utf-8');
          const meta = parseFrontmatter(content);
          const rawScripts = await scanSubDirFiles(path.join(skillDir, 'scripts'));
          const rawRefs = await scanSubDirFiles(path.join(skillDir, 'references'));

          const scripts = rawScripts.map(p => path.relative(process.cwd(), p));
          const references = rawRefs.map(p => path.relative(process.cwd(), p));

          localSkills.push({
            id: skillId,
            name: meta.name || skillId,
            desc: meta.description || '专业技能说明',
            file: path.relative(process.cwd(), skillMdPath),
            isGlobal: false,
            assets: { scripts, references }
          });
        } catch (err) {
          if (err.code !== 'ENOENT') console.error(`解析本地技能 ${skillId} 失败:`, err);
        }
      }

      const mergedMap = new Map(localSkills.map(s => [s.id, s]));

      if (includeGlobal) {
        const globalSkillsDir = path.join(os.homedir(), '.agents', 'skills');
        try {
          const globalItems = await fs.readdir(globalSkillsDir, { withFileTypes: true });
          for (const item of globalItems) {
            if (!item.isDirectory()) continue;
            const skillId = item.name;
            if (mergedMap.has(skillId)) continue;

            const skillDir = path.join(globalSkillsDir, skillId);
            const skillMdPath = path.join(skillDir, 'SKILL.md');

            try {
              const content = await fs.readFile(skillMdPath, 'utf-8');
              const meta = parseFrontmatter(content);
              const scripts = await scanSubDirFiles(path.join(skillDir, 'scripts'));
              const references = await scanSubDirFiles(path.join(skillDir, 'references'));

              mergedMap.set(skillId, {
                id: skillId,
                name: meta.name || skillId,
                desc: meta.description || '专业技能说明',
                file: skillMdPath,
                isGlobal: true,
                assets: { scripts, references }
              });
            } catch (err) {
              if (err.code !== 'ENOENT') console.error(`解析全局技能 ${skillId} 失败:`, err);
            }
          }
        } catch (_) {
          // 全局目录不存在则忽略
        }
      }

      res.json(Array.from(mergedMap.values()));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 获取内置执行策略元数据 */
  app.get('/api/execution-strategies', async (req, res) => {
    try {
      res.json(await listExecutionStrategies());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /** 获取后端注册的所有工具 Schema */
  app.get('/api/tools', (req, res) => {
    res.json(getToolSchemas());
  });

  /** 获取单次 sub-agent 完整运行轨迹 */
  app.get('/api/sub-agent-traces/:harnessId/:traceId', async (req, res) => {
    try {
      const trace = await loadSubAgentTrace(req.params.harnessId, req.params.traceId);
      res.json(trace);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  /** 获取 teammate 完整运行轨迹 */
  app.get('/api/team-traces/:harnessId/:teamId/:teammateId', async (req, res) => {
    try {
      const trace = await loadTeammateTrace(req.params.harnessId, req.params.teamId, req.params.teammateId);
      res.json(trace);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });
}

await ensureOffloadedGitignored();

await fs.mkdir(SESSIONS_DIR, { recursive: true }).catch(err => {
  console.error('[server.js] 自动创建 sessions 目录失败:', err);
});

const activeJobs = createActiveJobRegistry();

await cronScheduler.loadDurableJobs();
await cronScheduler.loadRunHistory();
cronScheduler.start();
startCronQueueProcessor({
  scheduler: cronScheduler,
  activeJobs,
  broadcastEvent: (harnessId, type, data) => broadcastAgentEvent(activeJobs, harnessId, type, data),
  harnessDir: HARNESS_DIR,
});

const cronApi = createCronApiHandlers(cronScheduler, {
  harnessExists: async (harnessId) => Boolean(await findSafeHarnessPath(harnessId, { harnessDir: HARNESS_DIR }))
});

const app = createServerApp({
  legacyChatHandler: handleLegacyChatRoute,
  cronApi,
  routeDeps: {
    harness: {
      harnessDir: HARNESS_DIR,
      sessionsDir: SESSIONS_DIR,
    },
    model: {
      envPath: dotEnvPath,
    },
    session: {
      sessionsDir: SESSIONS_DIR,
    },
    agentRun: {
      activeJobs,
      sessionsDir: SESSIONS_DIR,
    },
  },
  registerExtraRoutes,
});

app.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`\n🚀 LLM Space 代理服务器运行在 http://${displayHost}:${PORT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && !process.env.LLM_SPACE_API_TOKEN) {
    console.log('   ⚠️  当前 HOST 允许非本机访问，建议设置 LLM_SPACE_API_TOKEN');
  }
  console.log(`   前端访问：http://localhost:5174\n`);
});
