import { promises as fs } from 'fs';
import path from 'path';

export function getSessionPath(sessionsDir, harnessId) {
  return path.join(sessionsDir, `${harnessId}.json`);
}

export async function readSessionState(sessionsDir, harnessId) {
  const sessionPath = getSessionPath(sessionsDir, harnessId);
  try {
    const content = await fs.readFile(sessionPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

export async function resolveRunTeamContext({ sessionsDir, harnessId, requestedTeamContext }) {
  if (requestedTeamContext !== undefined && requestedTeamContext !== null) {
    return requestedTeamContext;
  }

  try {
    const sessionState = await readSessionState(sessionsDir, harnessId);
    return sessionState?.teamContext ?? null;
  } catch {
    return null;
  }
}

export async function buildPersistedSessionState({
  sessionsDir,
  harnessId,
  messages = [],
  todos = [],
  backgroundTasks = [],
  teamContext,
}) {
  let persistedTeamContext;
  if (teamContext !== undefined) {
    persistedTeamContext = teamContext;
  } else {
    persistedTeamContext = (await readSessionState(sessionsDir, harnessId))?.teamContext;
  }

  const sessionState = {
    messages,
    todos,
    backgroundTasks,
  };
  if (persistedTeamContext) {
    sessionState.teamContext = persistedTeamContext;
  }
  return sessionState;
}
