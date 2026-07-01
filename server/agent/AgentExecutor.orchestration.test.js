import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AgentExecutor, getCompactionTokenThresholds } from './AgentExecutor.js';
import { HookManager } from './HookManager.js';

function createExecutor(overrides = {}) {
  return new AgentExecutor({
    harnessId: 'orchestration-policy-test',
    systemPrompt: 'You are a coding assistant.',
    features: {},
    tools: [],
    ...overrides,
  });
}

test('parent-disabled orchestration strips every managed child tool but keeps current time once', () => {
  const executor = createExecutor({
    tools: ['bash', 'sub_agent', 'write_todos', 'query_background_tasks', 'schedule_cron', 'get_current_time'],
    features: {
      task_orchestration: {
        enabled: false,
        mode: 'task_system',
        enable_sub_agents: true,
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  assert.deepEqual(executor.tools.sort(), ['bash', 'get_current_time'].sort());
  assert.equal(executor.tools.filter(tool => tool === 'get_current_time').length, 1);
});

test('compaction thresholds scale with model context window', () => {
  assert.deepEqual(getCompactionTokenThresholds({ contextWindow: 1000000 }), {
    contextWindow: 1000000,
    soft: 750000,
    hard: 900000,
  });
  assert.deepEqual(getCompactionTokenThresholds({}), {
    contextWindow: 128000,
    soft: 96000,
    hard: 115200,
  });
});

test('hard compact preserves the current user message as the final message', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-hard-compact-'));
  await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const executor = createExecutor({
    harnessId: 'hard-compact-current-user',
    messages: [
      { role: 'user', type: 'text', turn: 1, content: 'old request' },
      { role: 'assistant', type: 'text', turn: 1, content: 'old answer' },
      { role: 'user', type: 'text', turn: 10, content: '你好' },
    ],
    onEvent() {},
  });
  executor._callLLMNonStream = async () => '<summary>old context summary</summary>';

  await executor.performHardCompact(10);

  assert.equal(executor.messages.at(-1).content, '你好');
  assert.equal(
    executor.messages.some(message => String(message.content).includes('Continue with the last task')),
    false,
  );
});

test('task-system mode mounts the task board tools once and preserves current time', () => {
  const executor = createExecutor({
    tools: ['bash', 'create_task', 'claim_task', 'get_current_time'],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'task_system',
      },
    },
  });

  assert.deepEqual(
    executor.tools.sort(),
    ['bash', 'create_task', 'list_tasks', 'get_task', 'claim_task', 'complete_task', 'get_current_time'].sort()
  );
  assert.equal(executor.tools.filter(tool => tool === 'get_current_time').length, 1);
});

test('background and cron tools require the canonical parent and child switches together', () => {
  const parentDisabled = createExecutor({
    tools: ['bash'],
    features: {
      task_orchestration: {
        enabled: false,
        mode: 'todo',
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  const childDisabled = createExecutor({
    tools: ['bash', 'query_background_tasks', 'schedule_cron'],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'todo',
        enable_background_tasks: false,
        enable_cron_scheduler: false,
      },
    },
  });

  const childEnabled = createExecutor({
    tools: ['bash'],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'todo',
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  assert.equal(parentDisabled.tools.includes('query_background_tasks'), false);
  assert.equal(parentDisabled.tools.includes('schedule_cron'), false);
  assert.equal(parentDisabled.tools.includes('list_crons'), false);
  assert.equal(parentDisabled.tools.includes('cancel_cron'), false);

  assert.equal(childDisabled.tools.includes('query_background_tasks'), false);
  assert.equal(childDisabled.tools.includes('schedule_cron'), false);
  assert.equal(childDisabled.tools.includes('list_crons'), false);
  assert.equal(childDisabled.tools.includes('cancel_cron'), false);

  assert.equal(childEnabled.tools.includes('query_background_tasks'), true);
  assert.equal(childEnabled.tools.includes('schedule_cron'), true);
  assert.equal(childEnabled.tools.includes('list_crons'), true);
  assert.equal(childEnabled.tools.includes('cancel_cron'), true);
  assert.equal(childEnabled.tools.filter(tool => tool === 'get_current_time').length, 1);
});

test('teammate runtime keeps team messaging but strips lead-only orchestration tools', () => {
  const executor = createExecutor({
    runtimeRole: 'teammate',
    tools: [
      'bash',
      'write_todos',
      'spawn_teammate',
      'send_team_message',
      'check_team_inbox',
      'sub_agent',
      'get_current_time',
    ],
    features: {
      task_orchestration: {
        enabled: true,
        mode: 'todo',
        enable_sub_agents: true,
        enable_agent_teams: true,
        enable_background_tasks: true,
        enable_cron_scheduler: true,
      },
    },
  });

  assert.equal(executor.runtimeRole, 'teammate');
  assert.deepEqual(executor.tools.sort(), ['bash', 'get_current_time', 'send_team_message'].sort());
});

test('teammate runtime does not mount MemoryPlugin when memory is enabled', () => {
  const originalRegister = HookManager.prototype.register;
  const registeredPluginNames = [];

  HookManager.prototype.register = function register(plugin) {
    registeredPluginNames.push(plugin?.name ?? '(anonymous)');
    return originalRegister.call(this, plugin);
  };

  try {
    createExecutor({
      runtimeRole: 'teammate',
      tools: ['bash', 'send_team_message'],
      features: {
        enable_memory: {
          enabled: true,
        },
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_agent_teams: true,
        },
      },
    });
  } finally {
    HookManager.prototype.register = originalRegister;
  }

  assert.equal(registeredPluginNames.includes('MemoryPlugin'), false);
});

test('teammate runtime does not mount planning plugins in todo or task-system modes', () => {
  const originalRegister = HookManager.prototype.register;
  const registeredPluginNames = [];

  HookManager.prototype.register = function register(plugin) {
    registeredPluginNames.push(plugin?.name ?? '(anonymous)');
    return originalRegister.call(this, plugin);
  };

  try {
    createExecutor({
      runtimeRole: 'teammate',
      tools: ['bash', 'send_team_message'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_agent_teams: true,
        },
      },
    });

    createExecutor({
      runtimeRole: 'teammate',
      tools: ['bash', 'send_team_message'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'task_system',
          enable_agent_teams: true,
        },
      },
    });
  } finally {
    HookManager.prototype.register = originalRegister;
  }

  assert.equal(registeredPluginNames.includes('TodoNagPlugin'), false);
  assert.equal(registeredPluginNames.includes('TaskSystemPlugin'), false);
});

test('TeamPlugin mounts for lead only when agent teams is enabled', () => {
  const originalRegister = HookManager.prototype.register;
  const registeredPluginNames = [];

  HookManager.prototype.register = function register(plugin) {
    registeredPluginNames.push(plugin?.name ?? '(anonymous)');
    return originalRegister.call(this, plugin);
  };

  try {
    createExecutor({
      runtimeRole: 'lead',
      tools: ['bash'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_agent_teams: true,
        },
      },
    });

    createExecutor({
      runtimeRole: 'lead',
      tools: ['bash'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_agent_teams: false,
        },
      },
    });
  } finally {
    HookManager.prototype.register = originalRegister;
  }

  const teamPluginRegistrations = registeredPluginNames.filter(name => name === 'TeamPlugin').length;
  assert.equal(teamPluginRegistrations, 1);
});

test('TeamPlugin mounts for teammate runtime even when lead team orchestration is disabled', () => {
  const originalRegister = HookManager.prototype.register;
  const registeredPluginNames = [];

  HookManager.prototype.register = function register(plugin) {
    registeredPluginNames.push(plugin?.name ?? '(anonymous)');
    return originalRegister.call(this, plugin);
  };

  try {
    createExecutor({
      runtimeRole: 'teammate',
      tools: ['bash', 'send_team_message'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_agent_teams: false,
        },
      },
    });
  } finally {
    HookManager.prototype.register = originalRegister;
  }

  assert.equal(registeredPluginNames.includes('TeamPlugin'), true);
});

test('RuntimeNotificationPlugin mounts after team producers in the preLLM chain', () => {
  const originalRegister = HookManager.prototype.register;
  const registeredPluginNames = [];

  HookManager.prototype.register = function register(plugin) {
    registeredPluginNames.push(plugin?.name ?? '(anonymous)');
    return originalRegister.call(this, plugin);
  };

  try {
    createExecutor({
      runtimeRole: 'lead',
      tools: ['bash'],
      features: {
        task_orchestration: {
          enabled: true,
          mode: 'todo',
          enable_agent_teams: true,
        },
      },
    });
  } finally {
    HookManager.prototype.register = originalRegister;
  }

  assert.ok(registeredPluginNames.includes('RuntimeNotificationPlugin'));
  assert.ok(registeredPluginNames.indexOf('TeamPlugin') < registeredPluginNames.indexOf('RuntimeNotificationPlugin'));
});

test('saveSession persists lightweight teamContext only when present', async (t) => {
  const originalCwd = process.cwd();
  const rootDir = await mkdtemp(path.join(tmpdir(), 'agent-executor-session-'));
  await mkdir(path.join(rootDir, 'server', 'sessions'), { recursive: true });
  process.chdir(rootDir);

  t.after(async () => {
    process.chdir(originalCwd);
    await rm(rootDir, { recursive: true, force: true });
  });

  const leadExecutor = createExecutor({
    harnessId: 'persist-team-context',
    messages: [{ role: 'user', content: 'hi' }],
    todos: [{ id: '1', text: 'todo' }],
    backgroundTasks: [{ id: 'bg-1', title: 'work' }],
    teamContext: { teamId: 'team_1', agentId: 'lead', leadId: 'lead' },
  });

  await leadExecutor.saveSession();

  const persistedLead = JSON.parse(
    await readFile(path.join(rootDir, 'server', 'sessions', 'persist-team-context.json'), 'utf-8'),
  );
  assert.deepEqual(persistedLead.teamContext, {
    teamId: 'team_1',
    agentId: 'lead',
    leadId: 'lead',
  });
  assert.deepEqual(persistedLead.messages, [{ role: 'user', content: 'hi' }]);
  assert.deepEqual(persistedLead.todos, [{ id: '1', text: 'todo' }]);
  assert.deepEqual(persistedLead.backgroundTasks, [{ id: 'bg-1', title: 'work' }]);

  const plainExecutor = createExecutor({
    harnessId: 'no-team-context',
    messages: [{ role: 'user', content: 'hello' }],
  });

  await plainExecutor.saveSession();

  const persistedPlain = JSON.parse(
    await readFile(path.join(rootDir, 'server', 'sessions', 'no-team-context.json'), 'utf-8'),
  );
  assert.equal('teamContext' in persistedPlain, false);
});
