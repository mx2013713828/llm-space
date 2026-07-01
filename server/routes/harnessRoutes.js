import { promises as fs } from 'fs';
import path from 'path';

import { AgentExecutor } from '../agent/AgentExecutor.js';
import { alignRequestPayload, buildApiMessages } from '../agent/messageBuilder.js';
import { SecurityPlugin } from '../agent/plugins/SecurityPlugin.js';
import { resolveSelectedStrategyId } from '../agent/strategies/strategyRegistry.js';
import { createCopiedHarnessDraft, createHarnessDraft } from '../harnessIdentity.js';
import { toolRegistry } from '../tools/ToolRegistry.js';

const DEFAULT_HARNESS_DIR = path.join(process.cwd(), 'harnesses');
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
  sessionsDir = DEFAULT_SESSIONS_DIR,
  fsImpl = fs,
  ExecutorClass = AgentExecutor,
  securityPlugin = SecurityPlugin,
  registry = toolRegistry,
  resolveStrategy = resolveSelectedStrategyId,
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
          harnesses.push({
            id: data.id,
            name: file,
            description: data.description,
            category: data.category || 'basic'
          });
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
          return res.json(data);
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
      const harness = createHarnessDraft({ name, description, existingHarnesses });
      const targetPath = path.join(harnessDir, harness.name);

      if (await fsImpl.access(targetPath).then(() => true).catch(() => false)) {
        return res.status(409).json({ error: '同名 Harness 已存在' });
      }

      await fsImpl.writeFile(targetPath, JSON.stringify(harness, null, 2), 'utf-8');
      res.json({ success: true, harness });
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
      await fsImpl.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf-8');
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
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

      const harness = createCopiedHarnessDraft({ source, existingHarnesses });
      await fsImpl.writeFile(path.join(harnessDir, harness.name), JSON.stringify(harness, null, 2), 'utf-8');
      res.json({ success: true, harness });
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
        skills
      } = req.body || {};

      const safeSkills = Array.isArray(skills) ? skills : [];
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
        skills: safeSkills,
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
        turnIndex: 1
      };

      await executor.hooks.dispatch('preLLM', context);
      const enabledToolNames = context.tools.map(t => typeof t === 'string' ? t : t.name);
      const toolSchemas = registry.getSchemas(enabledToolNames);
      const aligned = alignRequestPayload(
        context.systemPrompt || '',
        toolSchemas,
        context.apiMessages || [],
        executor.model
      );

      res.json({
        system: aligned.system,
        tools: aligned.tools,
        messages: aligned.messages
      });
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
