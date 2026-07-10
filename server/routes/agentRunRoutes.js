import path from 'path';

import { AgentExecutor } from '../agent/AgentExecutor.js';
import {
  buildRuntimeRequest as defaultBuildRuntimeRequest,
  getRuntimeHarnessId,
} from '../agent/runtimeRequest.js';
import { SecurityPlugin } from '../agent/plugins/SecurityPlugin.js';
import { resolveSelectedStrategyId as defaultResolveSelectedStrategyId } from '../agent/strategies/strategyRegistry.js';
import { resolveRunTeamContext as defaultResolveRunTeamContext } from '../sessions/sessionState.js';
import { defaultMcpManager } from '../mcp/mcpManager.js';
import { loadMcpMount as defaultLoadMcpMount } from '../mcp/mcpMountStore.js';

const DEFAULT_SESSIONS_DIR = path.join(process.cwd(), 'server', 'sessions');

export function sendEvent(res, type, data) {
  res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
}

export function prepareSseResponse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

function reserveJob(activeJobs, harnessId, initial) {
  if (typeof activeJobs.reserve === 'function') {
    return activeJobs.reserve(harnessId, initial);
  }
  const existing = activeJobs.get(harnessId);
  if (existing) return { reserved: false, job: existing };
  const job = {
    executor: initial.executor ?? null,
    clients: initial.clients || new Set(),
    source: initial.source,
  };
  activeJobs.set(harnessId, job);
  return { reserved: true, job };
}

function attachClient(activeJobs, harnessId, job, client) {
  if (typeof activeJobs.attach === 'function') {
    return activeJobs.attach(harnessId, client);
  }
  job.clients.add(client);
  return job;
}

function detachClient(activeJobs, harnessId, job, client) {
  if (typeof activeJobs.detach === 'function') {
    activeJobs.detach(harnessId, client);
    return;
  }
  job.clients.delete(client);
}

function setJobExecutor(activeJobs, harnessId, job, executor) {
  if (typeof activeJobs.setExecutor === 'function') {
    activeJobs.setExecutor(harnessId, executor);
    return;
  }
  job.executor = executor;
}

function releaseJob(activeJobs, harnessId) {
  if (typeof activeJobs.release === 'function') {
    activeJobs.release(harnessId);
    return;
  }
  const job = activeJobs.get(harnessId);
  if (job) {
    for (const client of job.clients) {
      client.end();
    }
    activeJobs.delete(harnessId);
  }
}

export function broadcastEvent(activeJobs, harnessId, type, data) {
  if (typeof activeJobs.broadcast === 'function') {
    return activeJobs.broadcast(harnessId, type, data, sendEvent);
  }
  const job = activeJobs.get(harnessId);
  if (!job) return 0;
  let sent = 0;
  for (const client of job.clients) {
    try {
      sendEvent(client, type, data);
      sent += 1;
    } catch {
      // Closed SSE clients are removed by their close handlers.
    }
  }
  return sent;
}

export async function attachToActiveJob({ activeJobs, harnessId, res, job }) {
  prepareSseResponse(res);
  attachClient(activeJobs, harnessId, job, res);

  if (job.executor) {
    sendEvent(res, 'messages_update', { messages: job.executor.messages });
    sendEvent(res, 'todo_update', { todos: job.executor.todos });
    sendEvent(res, 'background_tasks_update', { tasks: job.executor.backgroundTasks || [] });
  }

  await new Promise((resolve) => {
    res.on('close', () => {
      detachClient(activeJobs, harnessId, job, res);
      resolve();
    });
  });
}

export function registerAgentRunRoutes(app, {
  activeJobs,
  sessionsDir = DEFAULT_SESSIONS_DIR,
  ExecutorClass = AgentExecutor,
  buildRuntimeRequest = defaultBuildRuntimeRequest,
  resolveRunTeamContext = defaultResolveRunTeamContext,
  resolveSelectedStrategyId = defaultResolveSelectedStrategyId,
  resolvePermission = SecurityPlugin.resolvePermission,
  mcpManager = defaultMcpManager,
  loadMcpMount = defaultLoadMcpMount,
  logger = console,
} = {}) {
  if (!activeJobs) {
    throw new Error('registerAgentRunRoutes requires activeJobs');
  }

  app.post('/api/agent/run', async (req, res) => {
    const body = req.body || {};
    let harnessId;
    try {
      harnessId = getRuntimeHarnessId(body);
    } catch (err) {
      return res.status(err.statusCode || 400).json({ error: err.message });
    }

    const reservation = reserveJob(activeJobs, harnessId, { source: 'agent' });
    if (!reservation.reserved) {
      await attachToActiveJob({ activeJobs, harnessId, res, job: reservation.job });
      return;
    }

    const job = reservation.job;
    let runtimeRequest;
    try {
      runtimeRequest = await buildRuntimeRequest({
        body,
        sessionsDir,
        resolveRunTeamContext,
        resolveSelectedStrategyId,
      });
    } catch (err) {
      activeJobs.delete(harnessId);
      return res.status(err.statusCode || 500).json({ error: err.message });
    }

    if (!runtimeRequest.model?.key) {
      activeJobs.delete(harnessId);
      return res.status(400).json({ error: '缺少 API Key' });
    }

    let mountedResources = null;
    try {
      const mcpMount = await loadMcpMount({ harnessId });
      const mcpTools = await mcpManager.getMountedToolDefinitions(mcpMount);
      mountedResources = { tools: mcpTools };
    } catch (err) {
      logger.warn?.('[agentRunRoutes] Failed to mount MCP tools:', err.message);
      mountedResources = { tools: [] };
    }

    prepareSseResponse(res);

    const executor = new ExecutorClass({
      ...runtimeRequest,
      mountedResources,
      onEvent: (type, data) => {
        broadcastEvent(activeJobs, harnessId, type, data);
      }
    });

    setJobExecutor(activeJobs, harnessId, job, executor);
    attachClient(activeJobs, harnessId, job, res);

    sendEvent(res, 'background_tasks_update', { tasks: executor.backgroundTasks || [] });

    res.on('close', () => {
      detachClient(activeJobs, harnessId, job, res);
    });

    try {
      await executor.run();
    } catch (err) {
      logger.error?.('[agentRunRoutes /api/agent/run] 运行异常:', err);
      broadcastEvent(activeJobs, harnessId, 'error', { message: err.message });
    } finally {
      broadcastEvent(activeJobs, harnessId, 'done', {});
      releaseJob(activeJobs, harnessId);
    }
  });

  app.post('/api/agent/permission', (req, res) => {
    const { toolCallId, decision } = req.body;
    if (!toolCallId || !['allow', 'deny'].includes(decision)) {
      return res.status(400).json({ error: '缺少有效的 toolCallId 或 decision' });
    }

    const success = resolvePermission(toolCallId, decision);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '未找到对应处于挂起状态的权限申请' });
    }
  });

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

  app.get('/api/health', (_, res) => res.json({ status: 'ok', version: '1.0.0' }));
}
