import fs from 'fs/promises';
import path from 'path';

function getTaskDir(harnessId) {
  return path.join(process.cwd(), 'server', 'sessions', `${harnessId}_tasks`);
}

export async function clearTasks(harnessId) {
  const dir = getTaskDir(harnessId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}

export async function loadTasks(harnessId) {
  const dir = getTaskDir(harnessId);
  try {
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const tasks = [];
    for (const file of files) {
      if (file.endsWith('.json') && !file.endsWith('.lock.json')) {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        tasks.push(JSON.parse(content));
      }
    }
    return tasks;
  } catch (e) {
    return [];
  }
}

export async function saveTask(harnessId, task) {
  const dir = getTaskDir(harnessId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${task.id}.json`);
  await fs.writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');
}

export async function getTask(harnessId, taskId) {
  const dir = getTaskDir(harnessId);
  const filePath = path.join(dir, `${taskId}.json`);
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

export async function canStart(harnessId, taskId) {
  try {
    const tasks = await loadTasks(harnessId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;
    for (const depId of task.blockedBy) {
      const depTask = tasks.find(t => t.id === depId);
      if (!depTask || depTask.status !== 'completed') {
        return false;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

export function hasCycle(tasks) {
  const adj = new Map();
  const inDegree = new Map();

  tasks.forEach(t => {
    adj.set(t.id, []);
    inDegree.set(t.id, 0);
  });

  tasks.forEach(t => {
    (t.blockedBy || []).forEach(upstreamId => {
      if (adj.has(upstreamId)) {
        adj.get(upstreamId).push(t.id);
        inDegree.set(t.id, inDegree.get(t.id) + 1);
      }
    });
  });

  const queue = [];
  inDegree.forEach((degree, id) => {
    if (degree === 0) queue.push(id);
  });

  let visitedCount = 0;
  while (queue.length > 0) {
    const u = queue.shift();
    visitedCount++;
    (adj.get(u) || []).forEach(v => {
      inDegree.set(v, inDegree.get(v) - 1);
      if (inDegree.get(v) === 0) queue.push(v);
    });
  }

  return visitedCount !== tasks.length;
}

export async function claimTaskWithLock(harnessId, taskId, ownerId) {
  const dir = getTaskDir(harnessId);
  const lockPath = path.join(dir, `${taskId}.lock`);
  let lockHandle;
  try {
    lockHandle = await fs.open(lockPath, 'wx');
    
    const tasks = await loadTasks(harnessId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (task.status !== 'pending') throw new Error(`任务 ${taskId} 当前状态为 ${task.status}，无法认领`);
    
    const checkStart = await canStart(harnessId, taskId);
    if (!checkStart) {
      const pendingDeps = [];
      for (const depId of task.blockedBy) {
        const depTask = tasks.find(t => t.id === depId);
        if (!depTask || depTask.status !== 'completed') {
          pendingDeps.push(depId);
        }
      }
      throw new Error(`已被上游依赖阻塞: [${pendingDeps.join(', ')}]`);
    }

    task.status = 'in_progress';
    task.owner = ownerId;
    await saveTask(harnessId, task);
    return `成功认领任务: ${task.subject}`;
  } finally {
    if (lockHandle) {
      await lockHandle.close();
      await fs.unlink(lockPath).catch(() => {});
    }
  }
}
