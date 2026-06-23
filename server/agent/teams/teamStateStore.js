import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createTeamId, validateAgentName } from './teamEnvelope.js';
import { ensureWithinRoot, validateStorageId } from './teamPathGuards.js';

function normalizeTeammates(teammates) {
  const entries = Array.isArray(teammates) ? teammates : [];
  return Object.fromEntries(
    entries.map(teammate => {
      const agentId = validateAgentName(teammate?.agentId);
      return [agentId, { ...teammate, agentId }];
    }),
  );
}

export function getTeamPaths({ rootDir, harnessId, teamId, agentId }) {
  const safeHarnessId = validateStorageId('harnessId', harnessId);
  const safeTeamId = validateStorageId('teamId', teamId);
  const teamDir = ensureWithinRoot(rootDir, path.join(rootDir, `${safeHarnessId}_teams`, safeTeamId));
  const inboxDir = path.join(teamDir, 'inboxes');

  return {
    teamDir,
    inboxDir,
    inboxPath: agentId ? path.join(inboxDir, `${validateAgentName(agentId)}.jsonl`) : null,
    statePath: path.join(teamDir, 'state.json'),
  };
}

export function createTeamStateStore({ rootDir = path.join(process.cwd(), 'server', 'sessions') } = {}) {
  const teamWriteQueues = new Map();

  function getTeamQueueKey({ harnessId, teamId }) {
    return `${validateStorageId('harnessId', harnessId)}:${validateStorageId('teamId', teamId)}`;
  }

  async function queueTeamWrite({ harnessId, teamId, operation }) {
    const queueKey = getTeamQueueKey({ harnessId, teamId });
    const previous = teamWriteQueues.get(queueKey) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    teamWriteQueues.set(queueKey, current);

    try {
      return await current;
    } finally {
      if (teamWriteQueues.get(queueKey) === current) {
        teamWriteQueues.delete(queueKey);
      }
    }
  }

  async function loadState({ harnessId, teamId }) {
    const { statePath } = getTeamPaths({ rootDir, harnessId, teamId });
    try {
      const raw = await fs.readFile(statePath, 'utf-8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async function saveState({ harnessId, teamId, state }) {
    const { statePath } = getTeamPaths({ rootDir, harnessId, teamId });
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
    return state;
  }

  async function createTeam({ harnessId, teamId = createTeamId(), teammates = [] }) {
    return queueTeamWrite({
      harnessId,
      teamId,
      operation: async () => {
        const state = {
          teamId,
          teammates: normalizeTeammates(teammates),
        };
        return saveState({ harnessId, teamId, state });
      },
    });
  }

  async function upsertTeammate({ harnessId, teamId, teammate }) {
    return queueTeamWrite({
      harnessId,
      teamId,
      operation: async () => {
        const current = (await loadState({ harnessId, teamId })) ?? {
          teamId,
          teammates: {},
        };
        const agentId = validateAgentName(teammate?.agentId);
        current.teammates[agentId] = {
          ...(current.teammates[agentId] ?? {}),
          ...teammate,
          agentId,
        };
        return saveState({ harnessId, teamId, state: current });
      },
    });
  }

  async function updateTeammate({ harnessId, teamId, agentId, updates }) {
    return queueTeamWrite({
      harnessId,
      teamId,
      operation: async () => {
        const current = await loadState({ harnessId, teamId });
        const teammateName = validateAgentName(agentId);

        if (!current?.teammates?.[teammateName]) {
          throw new Error(`Unknown teammate: ${teammateName}`);
        }

        current.teammates[teammateName] = {
          ...current.teammates[teammateName],
          ...(updates ?? {}),
          agentId: teammateName,
        };
        return saveState({ harnessId, teamId, state: current });
      },
    });
  }

  return {
    loadState,
    saveState,
    createTeam,
    upsertTeammate,
    updateTeammate,
  };
}
