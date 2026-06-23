import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createMessageEnvelope } from './teamEnvelope.js';
import { getTeamPaths } from './teamStateStore.js';

async function parseInboxFile(inboxPath) {
  try {
    const raw = await fs.readFile(inboxPath, 'utf-8');
    const validMessages = [];
    const badLines = [];

    for (const line of raw.split('\n')) {
      if (!line.trim()) {
        continue;
      }
      try {
        validMessages.push(JSON.parse(line));
      } catch {
        badLines.push(`${line}\n`);
      }
    }

    return { validMessages, badLines };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { validMessages: [], badLines: [] };
    }
    throw error;
  }
}

export function createTeamBus({ rootDir = path.join(process.cwd(), 'server', 'sessions') } = {}) {
  async function sendMessage({ harnessId, ...input }) {
    const envelope = createMessageEnvelope(input);
    const { inboxPath } = getTeamPaths({
      rootDir,
      harnessId,
      teamId: envelope.teamId,
      agentId: envelope.to,
    });

    await fs.mkdir(path.dirname(inboxPath), { recursive: true });
    await fs.appendFile(inboxPath, `${JSON.stringify(envelope)}\n`, 'utf-8');
    return envelope;
  }

  async function peekInbox({ harnessId, teamId, agentId }) {
    const { inboxPath } = getTeamPaths({ rootDir, harnessId, teamId, agentId });
    const { validMessages } = await parseInboxFile(inboxPath);
    return validMessages;
  }

  async function readInbox({ harnessId, teamId, agentId }) {
    const { inboxPath } = getTeamPaths({ rootDir, harnessId, teamId, agentId });
    const { validMessages, badLines } = await parseInboxFile(inboxPath);

    await fs.mkdir(path.dirname(inboxPath), { recursive: true });
    await fs.writeFile(inboxPath, '', 'utf-8');
    if (badLines.length > 0) {
      await fs.appendFile(`${inboxPath}.bad`, badLines.join(''), 'utf-8');
    }

    return validMessages;
  }

  return {
    sendMessage,
    readInbox,
    peekInbox,
  };
}
