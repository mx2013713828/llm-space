/**
 * LLM Space - 本地代理服务器
 * 转发请求到 Anthropic 兼容 API，解决浏览器 CORS 限制
 * 支持 SSE 流式输出、extended thinking、工具调用
 */
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { getToolSchemas } from './server/tools/index.js';
import { toolRegistry } from './server/tools/ToolRegistry.js';
import { AgentExecutor } from './server/agent/AgentExecutor.js';
import { alignRequestPayload, buildApiMessages } from './server/agent/messageBuilder.js';
import { SecurityPlugin } from './server/agent/plugins/SecurityPlugin.js';
import { createCopiedHarnessDraft, createHarnessDraft } from './server/harnessIdentity.js';
import { handleLegacyChatRoute } from './server/legacyChatRoute.js';
import { parseModelsConfig, upsertModelsConfig } from './server/modelConfig.js';
import { cronScheduler } from './server/agent/scheduler/cronScheduler.js';
import { startCronQueueProcessor } from './server/agent/scheduler/cronRunner.js';
import { createCronApiHandlers } from './server/agent/scheduler/cronApi.js';
import { buildPersistedSessionState, readSessionState, resolveRunTeamContext } from './server/sessions/sessionState.js';
import { listExecutionStrategies, resolveSelectedStrategyId } from './server/agent/strategies/strategyRegistry.js';
import { loadSubAgentTrace } from './server/agent/subagents/subAgentTraceStore.js';
import { loadTeammateTrace } from './server/agent/teams/teammateTraceStore.js';

// 加载 .env 文件到 process.env
const dotEnvPath = path.join(process.cwd(), '.env');
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
} catch { console.log('  ⚠️  .env 文件未找到，跳过'); }

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

await ensureOffloadedGitignored();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5174' }));
app.use(express.json({ limit: '4mb' }));

/** 发送 SSE 事件 */
function sendEvent(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

/** Legacy direct proxy endpoint. New runs must use /api/agent/run. */
app.post('/api/chat', handleLegacyChatRoute);

const HARNESS_DIR = path.join(process.cwd(), 'harnesses');
const SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');

// 自动检测并创建 sessions 目录
fs.mkdir(SESSIONS_DIR, { recursive: true }).catch(err => {
  console.error('[server.js] 自动创建 sessions 目录失败:', err);
});

/**
 * 安全校验与查找：验证 harnessId 格式，并在 harnesses 目录下遍历寻找到对应的物理文件路径，防止路径穿越攻击
 */
async function findSafeHarnessPath(harnessId) {
  if (!harnessId || typeof harnessId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
    throw new Error('Invalid harness ID format');
  }
  const resolvedHarnessDir = path.resolve(HARNESS_DIR);
  const files = await fs.readdir(resolvedHarnessDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(resolvedHarnessDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      if (data.id === harnessId) {
        const resolvedPath = path.resolve(filePath);
        if (!resolvedPath.startsWith(resolvedHarnessDir)) {
          throw new Error('Access denied: Path traversal detected');
        }
        return resolvedPath;
      }
    } catch (_) {}
  }
  return null;
}

async function loadHarnessesFromDir() {
  await fs.mkdir(HARNESS_DIR, { recursive: true });
  const files = await fs.readdir(HARNESS_DIR);
  const harnesses = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      harnesses.push(JSON.parse(content));
    } catch (_) {}
  }

  return harnesses;
}

// Active jobs memory registry for background running and client attachments
const activeJobs = new Map(); // harnessId -> { executor, clients: Set<res> }

// Push SSE event to all clients listening to a specific harness
function broadcastEvent(harnessId, type, data) {
  const job = activeJobs.get(harnessId);
  if (job) {
    for (const client of job.clients) {
      try {
        sendEvent(client, type, data);
      } catch (err) {
        // Safe check for closed stream
      }
    }
  }
}

function prepareSseResponse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

async function attachToActiveJob(res, job) {
  prepareSseResponse(res);
  job.clients.add(res);

  if (job.executor) {
    sendEvent(res, 'messages_update', { messages: job.executor.messages });
    sendEvent(res, 'todo_update', { todos: job.executor.todos });
    sendEvent(res, 'background_tasks_update', { tasks: job.executor.backgroundTasks || [] });
  }

  await new Promise((resolve) => {
    res.on('close', () => {
      job.clients.delete(res);
      resolve();
    });
  });
}

await cronScheduler.loadDurableJobs();
await cronScheduler.loadRunHistory();
cronScheduler.start();
startCronQueueProcessor({ scheduler: cronScheduler, activeJobs, broadcastEvent });
const cronApi = createCronApiHandlers(cronScheduler, {
  harnessExists: async (harnessId) => Boolean(await findSafeHarnessPath(harnessId))
});

app.get('/api/harnesses/:harnessId/cron-jobs', cronApi.list);
app.get('/api/harnesses/:harnessId/cron-runs', cronApi.listRuns);
app.post('/api/harnesses/:harnessId/cron-jobs', cronApi.create);
app.delete('/api/harnesses/:harnessId/cron-jobs/:jobId', cronApi.remove);

/** 获取所有 Harness 文件列表 */
app.get('/api/harnesses', async (req, res) => {
  try {
    await fs.mkdir(HARNESS_DIR, { recursive: true });
    const files = await fs.readdir(HARNESS_DIR);
    const harnesses = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      try {
        const data = JSON.parse(content);
        harnesses.push({
          id: data.id,
          name: file,
          description: data.description,
          category: data.category || 'basic'
        });
      } catch (e) { }
    }
    res.json(harnesses.sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 获取单个 Harness 配置 */
app.get('/api/harnesses/:id', async (req, res) => {
  try {
    const files = await fs.readdir(HARNESS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      const data = JSON.parse(content);
      if (data.id === req.params.id) {
        return res.json(data);
      }
    }
    res.status(404).json({ error: 'Harness not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 新建 Harness 配置 */
app.post('/api/harnesses', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: '缺少 name 字段' });

    const existingHarnesses = await loadHarnessesFromDir();
    const harness = createHarnessDraft({ name, description, existingHarnesses });
    const targetPath = path.join(HARNESS_DIR, harness.name);

    if (await fs.access(targetPath).then(() => true).catch(() => false)) {
      return res.status(409).json({ error: '同名 Harness 已存在' });
    }

    await fs.writeFile(targetPath, JSON.stringify(harness, null, 2), 'utf-8');
    res.json({ success: true, harness });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/** 保存/更新 Harness 配置 */
app.post('/api/harnesses/:id', async (req, res) => {
  try {
    const data = req.body;
    let filename = `${req.params.id}.json`;

    // 查找是否已经存在该 ID 对应的文件，避免生成多余的同 ID 文件
    const files = await fs.readdir(HARNESS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      try {
        const parsed = JSON.parse(content);
        if (parsed.id === req.params.id) {
          filename = file;
          break;
        }
      } catch (e) {}
    }

    const targetPath = path.join(HARNESS_DIR, filename);
    await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 删除 Harness 配置 */
app.delete('/api/harnesses/:id', async (req, res) => {
  try {
    const files = await fs.readdir(HARNESS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const content = await fs.readFile(path.join(HARNESS_DIR, file), 'utf-8');
      try {
        const data = JSON.parse(content);
        if (data.id === req.params.id) {
          await fs.unlink(path.join(HARNESS_DIR, file));
          // 联动删除对应 session 磁盘文件
          const sessionPath = path.join(SESSIONS_DIR, `${req.params.id}.json`);
          await fs.unlink(sessionPath).catch(() => {});
          return res.json({ success: true });
        }
      } catch { }
    }
    res.status(404).json({ error: 'Harness not found' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** 复制 Harness 配置 */
app.post('/api/harnesses/:id/copy', async (req, res) => {
  try {
    const existingHarnesses = await loadHarnessesFromDir();
    const source = existingHarnesses.find(harness => harness.id === req.params.id);
    if (!source) return res.status(404).json({ error: 'Harness not found' });

    const harness = createCopiedHarnessDraft({ source, existingHarnesses });
    await fs.writeFile(path.join(HARNESS_DIR, harness.name), JSON.stringify(harness, null, 2), 'utf-8');
    res.json({ success: true, harness });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * POST /api/harnesses/:harnessId/dry-run
 * 在内存中临时实例化 AgentExecutor 并模拟运行 preLLM 钩子，
 * 返回最终对齐后的 { system, tools, messages } Payload，供前端显示。
 */
app.post('/api/harnesses/:harnessId/dry-run', async (req, res) => {
  const { harnessId } = req.params;

  // 1. 安全校验与文件存在性检查
  let safePath;
  try {
    safePath = await findSafeHarnessPath(harnessId);
    if (!safePath) {
      return res.status(404).json({ error: `Harness config for ${harnessId} not found` });
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  let executor;
  try {
    const {
      messages,
      todos,
      systemPrompt,
      tools,
      features,
      model,
      temperature,
      maxTokens,
      thinkingEnabled,
      selectedStrategyId,
      skills
    } = req.body || {};

    // 2. 边界防卫：规避构造函数中的 [...skills] 崩溃隐患
    const safeSkills = Array.isArray(skills) ? skills : [];

    // 3. 实例化 AgentExecutor
    executor = new AgentExecutor({
      harnessId,
      messages: messages || [],
      todos: todos || [],
      systemPrompt: systemPrompt || '',
      tools: tools || [],
      features: features || {},
      model: model || {},
      temperature: temperature ?? 1,
      maxTokens: maxTokens ?? 8192,
      thinkingEnabled: !!thinkingEnabled,
      selectedStrategyId: resolveSelectedStrategyId({ explicitStrategyId: selectedStrategyId, features }),
      skills: safeSkills,
      onEvent: () => {}
    });

    // 4. 构造 context
    const context = {
      executor,
      messages: executor.messages,
      apiMessages: buildApiMessages(
        executor.messages,
        executor.thinkingEnabled,
        executor.features.context_compaction,
      ),
      systemPrompt: executor.systemPrompt || '',
      tools: executor.tools,
      turnIndex: 1
    };

    // 5. 运行 preLLM 钩子
    await executor.hooks.dispatch('preLLM', context);

    // 6. 获取工具 schemas 并执行 alignRequestPayload
    const enabledToolNames = context.tools.map(t => typeof t === 'string' ? t : t.name);
    const toolSchemas = toolRegistry.getSchemas(enabledToolNames);

    const aligned = alignRequestPayload(
      context.systemPrompt || '',
      toolSchemas,
      context.apiMessages || [],
      executor.model
    );

    // 7. 将对齐后的 Payload 返回前端
    res.json({
      system: aligned.system,
      tools: aligned.tools,
      messages: aligned.messages
    });
  } catch (err) {
    console.error('[server.js /api/harnesses/:harnessId/dry-run] Error:', err);
    res.status(500).json({ error: `Dry-Run 模拟运行失败: ${err.message}` });
  } finally {
    // 8. 防御性编程：清理审批挂载引用，防范内存泄漏
    if (executor) {
      SecurityPlugin.clearExecutorPending(executor);
    }
  }
});

const SKILLS_DIR = path.join(process.cwd(), 'skills');

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
  } catch (e) {
    // 忽略目录不存在等异常
  }
  return files;
}


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
    
    // 1. 扫描项目本地技能
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
        
        // 扫描本地 scripts 和 references
        const rawScripts = await scanSubDirFiles(path.join(skillDir, 'scripts'));
        const rawRefs = await scanSubDirFiles(path.join(skillDir, 'references'));
        
        // 转换为相对路径
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

    // 2. 有条件地扫描全局 ~/.agents/skills
    if (includeGlobal) {
      const globalSkillsDir = path.join(os.homedir(), '.agents', 'skills');
      try {
        const globalItems = await fs.readdir(globalSkillsDir, { withFileTypes: true });
        for (const item of globalItems) {
          if (!item.isDirectory()) continue;
          const skillId = item.name;
          
          // 本地覆盖全局：如果 localSkills 里已经有了，跳过加载全局
          if (mergedMap.has(skillId)) continue;

          const skillDir = path.join(globalSkillsDir, skillId);
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          
          try {
            const content = await fs.readFile(skillMdPath, 'utf-8');
            const meta = parseFrontmatter(content);
            
            // 扫描绝对路径下的 assets
            const scripts = await scanSubDirFiles(path.join(skillDir, 'scripts'));
            const references = await scanSubDirFiles(path.join(skillDir, 'references'));

            mergedMap.set(skillId, {
              id: skillId,
              name: meta.name || skillId,
              desc: meta.description || '专业技能说明',
              file: skillMdPath, // 全局技能返回宿主机绝对路径
              isGlobal: true,
              assets: { scripts, references }
            });
          } catch (err) {
            if (err.code !== 'ENOENT') console.error(`解析全局技能 ${skillId} 失败:`, err);
          }
        }
      } catch (err) {
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

/** Agent 运行端点 (支持后台运行和多客户端订阅广播) */
app.post('/api/agent/run', async (req, res) => {
  const {
    harnessId,
    messages,
    todos,
    backgroundTasks,
    teamContext,
    systemPrompt,
    tools,
    features,
    model,
    temperature,
    maxTokens,
    thinkingEnabled,
    selectedStrategyId,
    interactionMode,
    skills
  } = req.body;

  if (!harnessId) {
    return res.status(400).json({ error: '缺少 harnessId' });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
    return res.status(400).json({ error: '非法的 Harness ID' });
  }

  if (activeJobs.has(harnessId)) {
    await attachToActiveJob(res, activeJobs.get(harnessId));
    return;
  }

  const job = { executor: null, clients: new Set() };
  activeJobs.set(harnessId, job);

  // Branch 2: The job is not running yet - requires API Key
  if (!model?.key) {
    activeJobs.delete(harnessId);
    return res.status(400).json({ error: '缺少 API Key' });
  }

  // 设置 SSE 响应头 (启动新运行任务)
  prepareSseResponse(res);

  const effectiveTeamContext = await resolveRunTeamContext({
    sessionsDir: SESSIONS_DIR,
    harnessId,
    requestedTeamContext: teamContext,
  });

  // Branch 2: The job is not running yet
  const executor = new AgentExecutor({
    harnessId,
    teamContext: effectiveTeamContext,
    messages,
    todos,
    backgroundTasks,
    systemPrompt,
    tools,
    features,
    model,
    temperature,
    maxTokens,
    thinkingEnabled,
    selectedStrategyId: resolveSelectedStrategyId({ explicitStrategyId: selectedStrategyId, features }),
    interactionMode,
    skills,
    onEvent: (type, data) => {
      broadcastEvent(harnessId, type, data);
    }
  });

  job.executor = executor;
  job.clients.add(res);
  
  // 初始化发送一次已有后台任务给客户端
  sendEvent(res, 'background_tasks_update', { tasks: executor.backgroundTasks || [] });

  // Listen to connection close and remove client, but keep the job running in background
  res.on('close', () => {
    job.clients.delete(res);
  });

  try {
    await executor.run();
  } catch (err) {
    console.error('[server.js /api/agent/run] 运行异常:', err);
    broadcastEvent(harnessId, 'error', { message: err.message });
  } finally {
    // Notify all clients of completion
    broadcastEvent(harnessId, 'done', {});

    // Close connections for all remaining clients
    const currentJob = activeJobs.get(harnessId);
    if (currentJob) {
      for (const client of currentJob.clients) {
        client.end();
      }
      activeJobs.delete(harnessId);
    }
  }
});

/** 提交安全审批决定 */
app.post('/api/agent/permission', (req, res) => {
  const { toolCallId, decision } = req.body;
  if (!toolCallId || !['allow', 'deny'].includes(decision)) {
    return res.status(400).json({ error: '缺少有效的 toolCallId 或 decision' });
  }

  const success = SecurityPlugin.resolvePermission(toolCallId, decision);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '未找到对应处于挂起状态的权限申请' });
  }
});

/** 查询任务运行状态 */
app.get('/api/agent/status/:harnessId', (req, res) => {
  const harnessId = req.params.harnessId;
  const job = activeJobs.get(harnessId);
  const isRunning = !!job;
  let pendingPermission = null;
  let backgroundTasks = [];
  if (job && job.executor) {
    pendingPermission = job.executor.pendingPermission || null;
    backgroundTasks = job.executor.backgroundTasks || [];
  }
  res.json({ isRunning, pendingPermission, backgroundTasks });
});

/** 健康检查 */
app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));

/**
 * GET /api/models
 * 从已加载的 process.env 读取模型列表（启动时由 .env 加载）
 */
app.get('/api/models', async (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    const envStr = await fs.readFile(envPath, 'utf-8').catch(() => '');
    const models = parseModelsConfig(envStr);
    process.env.MODELS_CONFIG = JSON.stringify(models);
    return res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/models
 * 添加新的模型配置并写入 .env
 */
app.post('/api/models', async (req, res) => {
  try {
    const newModel = req.body; // { name, url, key, modelId }
    const envPath = path.join(process.cwd(), '.env');
    let envStr = await fs.readFile(envPath, 'utf-8').catch(() => '');
    const models = parseModelsConfig(envStr);

    // 如果没有 id，生成一个
    if (!newModel.id) newModel.id = Date.now().toString();

    models.push(newModel);
    envStr = upsertModelsConfig(envStr, models);

    await fs.writeFile(envPath, envStr, 'utf-8');
    process.env.MODELS_CONFIG = JSON.stringify(models);  // 同步更新内存
    res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * PUT /api/models/:id
 * 更新已有模型配置并写入 .env
 */
app.put('/api/models/:id', async (req, res) => {
  try {
    const envPath = path.join(process.cwd(), '.env');
    let envStr = await fs.readFile(envPath, 'utf-8').catch(() => '');
    const models = parseModelsConfig(envStr);
    const idx = models.findIndex(m => String(m.id) === String(req.params.id));

    if (idx === -1) {
      return res.status(404).json({ error: 'Model not found' });
    }

    const updatedModel = {
      ...models[idx],
      ...req.body,
      id: models[idx].id,
    };
    models[idx] = updatedModel;
    envStr = upsertModelsConfig(envStr, models);

    await fs.writeFile(envPath, envStr, 'utf-8');
    process.env.MODELS_CONFIG = JSON.stringify(models);
    res.json(models);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/** GET /api/sessions/:harnessId - 加载会话记录 */
app.get('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const sessionState = await readSessionState(SESSIONS_DIR, harnessId);
    if (!sessionState) {
      return res.json(null); // 不存在则返回 null
    }
    res.json(sessionState);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/sessions/:harnessId - 保存/同步会话记录 */
app.post('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const { messages, todos, backgroundTasks, teamContext } = req.body;
    const sessionPath = path.join(SESSIONS_DIR, `${harnessId}.json`);
    const sessionState = await buildPersistedSessionState({
      sessionsDir: SESSIONS_DIR,
      harnessId,
      messages: messages || [],
      todos: todos || [],
      backgroundTasks: backgroundTasks || [],
      teamContext,
    });

    await fs.writeFile(sessionPath, JSON.stringify(sessionState, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/sessions/:harnessId - 删除/重置会话记录 */
app.delete('/api/sessions/:harnessId', async (req, res) => {
  try {
    const harnessId = req.params.harnessId;
    if (!/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
      return res.status(400).json({ error: '非法的 Harness ID' });
    }
    const sessionPath = path.join(SESSIONS_DIR, `${harnessId}.json`);
    await fs.unlink(sessionPath).catch(() => {}); // 允许文件不存在
    
    // 级联清理任务物理目录
    const tasksDir = path.join(SESSIONS_DIR, `${harnessId}_tasks`);
    await fs.rm(tasksDir, { recursive: true, force: true }).catch(() => {});
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 LLM Space 代理服务器运行在 http://localhost:${PORT}`);
  console.log(`   前端访问：http://localhost:5174\n`);
});
