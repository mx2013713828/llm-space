import { promises as fs } from 'fs';
import path from 'path';

import { AgentExecutor } from '../agent/AgentExecutor.js';
import { alignRequestPayload, buildApiMessages } from '../agent/messageBuilder.js';
import { summarizePromptAssembly } from '../agent/promptAssembly/promptAssembly.js';
import { SecurityPlugin } from '../agent/plugins/SecurityPlugin.js';
import { createRuntimeNotificationQueue, summarizeNotificationsForUi } from '../agent/runtimeNotifications.js';
import { listMemoryCandidates } from '../agent/memory/memoryCandidateStore.js';
import {
  loadAgentGuidance,
  saveAgentGuidance,
  stripLegacySystemPrompt,
} from '../agent/guidance/agentGuidance.js';
import { resolveSelectedStrategyId } from '../agent/strategies/strategyRegistry.js';
import { describeToolPool } from '../agent/toolPool.js';
import {
  createCopiedHarnessDraft,
  createHarnessDraft,
  createHarnessSummary,
  normalizeHarnessDisplayName,
} from '../harnessIdentity.js';
import { listMountedKnowledgeBases, loadKnowledgeBase } from '../knowledge/knowledgeStore.js';
import { retrieveKnowledge } from '../knowledge/knowledgeRetrieve.js';
import { getToolSchemasForTools } from '../tools/index.js';
import { toolRegistry } from '../tools/ToolRegistry.js';
import { defaultMcpManager } from '../mcp/mcpManager.js';
import { loadMcpMount as defaultLoadMcpMount } from '../mcp/mcpMountStore.js';
import { compactKnowledgeRuntimeFeatures } from '../../src/lib/knowledgeRuntime.js';

const DEFAULT_HARNESS_DIR = path.join(process.cwd(), 'harnesses');
const DEFAULT_GUIDANCE_ROOT = path.join(process.cwd(), 'guidance');
const DEFAULT_SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');

export async function findSafeHarnessPath(harnessId, { harnessDir = DEFAULT_HARNESS_DIR, fsImpl = fs } = {}) {
  if (!harnessId || typeof harnessId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(harnessId)) {
    throw new Error('Invalid harness ID format');
  }
  const resolvedHarnessDir = path.resolve(harnessDir);
  const files = await fsImpl.readdir(resolvedHarnessDir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(resolvedHarnessDir, file);
    try {
      const content = await fsImpl.readFile(filePath, 'utf-8');
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

export async function loadHarnessesFromDir({ harnessDir = DEFAULT_HARNESS_DIR, fsImpl = fs } = {}) {
  await fsImpl.mkdir(harnessDir, { recursive: true });
  const files = await fsImpl.readdir(harnessDir);
  const harnesses = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const content = await fsImpl.readFile(path.join(harnessDir, file), 'utf-8');
      harnesses.push(JSON.parse(content));
    } catch (_) {}
  }

  return harnesses;
}

export function registerHarnessRoutes(app, {
  harnessDir = DEFAULT_HARNESS_DIR,
  guidanceRoot = DEFAULT_GUIDANCE_ROOT,
  sessionsDir = DEFAULT_SESSIONS_DIR,
  fsImpl = fs,
  ExecutorClass = AgentExecutor,
  securityPlugin = SecurityPlugin,
  registry = toolRegistry,
  resolveStrategy = resolveSelectedStrategyId,
  memoryCandidateStore = { listMemoryCandidates },
  knowledgeRoot,
  mcpManager = defaultMcpManager,
  loadMcpMount = defaultLoadMcpMount,
} = {}) {
  app.get('/api/harnesses', async (req, res) => {
    try {
      await fsImpl.mkdir(harnessDir, { recursive: true });
      const files = await fsImpl.readdir(harnessDir);
      const harnesses = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await fsImpl.readFile(path.join(harnessDir, file), 'utf-8');
        try {
          const data = JSON.parse(content);
          harnesses.push(createHarnessSummary(data, file));
        } catch (_) {}
      }
      res.json(harnesses.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/harnesses/:id', async (req, res) => {
    try {
      const files = await fsImpl.readdir(harnessDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await fsImpl.readFile(path.join(harnessDir, file), 'utf-8');
        const data = JSON.parse(content);
        if (data.id === req.params.id) {
          return res.json(await hydrateHarnessGuidance({
            harness: { ...data, name: normalizeHarnessDisplayName(data.name) || data.id },
            harnessId: req.params.id,
            guidanceRoot,
            fsImpl,
          }));
        }
      }
      res.status(404).json({ error: 'Harness not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/harnesses', async (req, res) => {
    try {
      const { name, description } = req.body;
      if (!name) return res.status(400).json({ error: '缺少 name 字段' });

      const existingHarnesses = await loadHarnessesFromDir({ harnessDir, fsImpl });
      const draft = createHarnessDraft({ name, description, existingHarnesses });
      const targetPath = path.join(harnessDir, draft.filename);

      if (await fsImpl.access(targetPath).then(() => true).catch(() => false)) {
        return res.status(409).json({ error: '同名 Harness 已存在' });
      }

      await fsImpl.writeFile(targetPath, JSON.stringify(draft.harness, null, 2), 'utf-8');
      res.json({ success: true, harness: draft.harness, filename: draft.filename });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/harnesses/:id', async (req, res) => {
    try {
      const data = req.body;
      let filename = `${req.params.id}.json`;

      const files = await fsImpl.readdir(harnessDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await fsImpl.readFile(path.join(harnessDir, file), 'utf-8');
        try {
          const parsed = JSON.parse(content);
          if (parsed.id === req.params.id) {
            filename = file;
            break;
          }
        } catch (_) {}
      }

      const targetPath = path.join(harnessDir, filename);
      const guidance = await saveAgentGuidance({
        harnessId: req.params.id,
        content: data.systemPrompt || '',
        guidanceRoot,
        fsImpl,
      });
      const harnessToSave = {
        ...compactHarnessKnowledgeRuntime(stripLegacySystemPrompt(data)),
        name: normalizeHarnessDisplayName(data.name) || req.params.id,
        guidance: {
          ...(data.guidance && typeof data.guidance === 'object' ? data.guidance : {}),
          file: guidance.file,
        },
      };
      await fsImpl.writeFile(targetPath, JSON.stringify(harnessToSave, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/harnesses/:id/metadata', async (req, res) => {
    try {
      const targetPath = await findSafeHarnessPath(req.params.id, { harnessDir, fsImpl });
      if (!targetPath) return res.status(404).json({ error: 'Harness not found' });

      const displayName = normalizeHarnessDisplayName(req.body?.name);
      if (!displayName) return res.status(400).json({ error: 'Harness name is required' });

      const existing = JSON.parse(await fsImpl.readFile(targetPath, 'utf-8'));
      const harness = {
        ...compactHarnessKnowledgeRuntime(existing),
        name: displayName,
        description: String(req.body?.description || ''),
      };
      const filename = path.basename(targetPath);
      await fsImpl.writeFile(targetPath, JSON.stringify(harness, null, 2), 'utf-8');
      res.json({
        success: true,
        harness: createHarnessSummary(harness, filename),
        filename,
      });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.delete('/api/harnesses/:id', async (req, res) => {
    try {
      const files = await fsImpl.readdir(harnessDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const content = await fsImpl.readFile(path.join(harnessDir, file), 'utf-8');
        try {
          const data = JSON.parse(content);
          if (data.id === req.params.id) {
            await fsImpl.unlink(path.join(harnessDir, file));
            const sessionPath = path.join(sessionsDir, `${req.params.id}.json`);
            await fsImpl.unlink(sessionPath).catch(() => {});
            return res.json({ success: true });
          }
        } catch (_) {}
      }
      res.status(404).json({ error: 'Harness not found' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/harnesses/:id/copy', async (req, res) => {
    try {
      const existingHarnesses = await loadHarnessesFromDir({ harnessDir, fsImpl });
      const source = existingHarnesses.find(harness => harness.id === req.params.id);
      if (!source) return res.status(404).json({ error: 'Harness not found' });

      const draft = createCopiedHarnessDraft({
        source,
        existingHarnesses,
        name: req.body?.name,
        description: req.body?.description,
      });
      const harness = compactHarnessKnowledgeRuntime(draft.harness);
      await fsImpl.writeFile(path.join(harnessDir, draft.filename), JSON.stringify(harness, null, 2), 'utf-8');
      res.json({ success: true, harness, filename: draft.filename });
    } catch (err) {
      res.status(err.statusCode || 500).json({ error: err.message });
    }
  });

  app.post('/api/harnesses/:harnessId/dry-run', async (req, res) => {
    const { harnessId } = req.params;
    let safePath;
    try {
      safePath = await findSafeHarnessPath(harnessId, { harnessDir, fsImpl });
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
        dryRunMode,
        includeDebugSummaries,
        skills
      } = req.body || {};

      const safeSkills = Array.isArray(skills) ? skills : [];
      const dryRunNotificationQueue = createRuntimeNotificationQueue();
      let mountedResources = { tools: [], mcpMount: null };
      try {
        const mcpMount = await loadMcpMount({ harnessId });
        mountedResources = {
          tools: await mcpManager.getMountedToolDefinitions(mcpMount),
          mcpMount,
        };
      } catch (err) {
        console.warn('[harnessRoutes dry-run] Failed to mount MCP tools:', err.message);
      }
      executor = new ExecutorClass({
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
        selectedStrategyId: resolveStrategy({ explicitStrategyId: selectedStrategyId, features }),
        dryRunMode: dryRunMode === 'static_context' ? 'static_context' : '',
        skills: safeSkills,
        mountedResources,
        runtimeNotificationQueue: dryRunNotificationQueue,
        knowledgeDependencies: {
          listMountedKnowledgeBases: (args) => listMountedKnowledgeBases({ ...args, knowledgeRoot }),
          loadKnowledgeBase: (args) => loadKnowledgeBase({ ...args, knowledgeRoot }),
          retrieveKnowledge: (args) => retrieveKnowledge({ ...args, knowledgeRoot }),
        },
        onEvent: () => {}
      });

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
        turnIndex: 1,
        promptAssemblySections: [...(executor.promptAssemblySections || [])],
      };

      await executor.hooks.dispatch('preLLM', context);
      const toolSchemas = getToolSchemasForTools(context.tools, registry);
      const aligned = alignRequestPayload(
        context.systemPrompt || '',
        toolSchemas,
        context.apiMessages || [],
        executor.model
      );
      const promptAssembly = summarizePromptAssembly(context.promptAssemblySections || []);

      const responsePayload = {
        system: aligned.system,
        tools: aligned.tools,
        messages: aligned.messages,
        promptAssembly,
      };

      if (includeDebugSummaries) {
        responsePayload.toolPoolSummary = describeToolPool(executor.toolPool);
        responsePayload.runtimeNotificationSummary = context.runtimeNotificationSummary || summarizeNotificationsForUi([]);
        responsePayload.memoryCandidateSummary = await buildMemoryCandidateSummary({ harnessId, memoryCandidateStore });
      }

      res.json(responsePayload);
    } catch (err) {
      console.error('[harnessRoutes /api/harnesses/:harnessId/dry-run] Error:', err);
      res.status(500).json({ error: `Dry-Run 模拟运行失败: ${err.message}` });
    } finally {
      if (executor) {
        securityPlugin.clearExecutorPending(executor);
      }
    }
  });
}

function compactHarnessKnowledgeRuntime(harness) {
  if (!harness?.features || typeof harness.features !== 'object') {
    return harness;
  }

  return {
    ...harness,
    features: compactKnowledgeRuntimeFeatures(harness.features),
  };
}

async function hydrateHarnessGuidance({ harness, harnessId, guidanceRoot, fsImpl }) {
  const guidance = await loadAgentGuidance({
    harnessId,
    fallbackContent: harness.systemPrompt || '',
    guidanceRoot,
    fsImpl,
  });

  return {
    ...harness,
    systemPrompt: guidance.content,
    guidance: {
      ...(harness.guidance && typeof harness.guidance === 'object' ? harness.guidance : {}),
      file: guidance.file,
      filename: guidance.filename,
      source: guidance.source,
    },
  };
}

async function buildMemoryCandidateSummary({ harnessId, memoryCandidateStore }) {
  try {
    const candidates = await memoryCandidateStore.listMemoryCandidates({ harnessId });
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const candidate of candidates || []) {
      if (candidate?.status in counts) counts[candidate.status] += 1;
    }

    return {
      counts,
      previews: (candidates || []).slice(0, 3).map(candidate => ({
        id: candidate.id,
        status: candidate.status,
        name: candidate.item?.name || '',
        description: candidate.item?.description || '',
        reason: candidate.reason || candidate.rejectionReason || '',
      })),
    };
  } catch {
    return {
      counts: { pending: 0, approved: 0, rejected: 0 },
      previews: [],
    };
  }
}
