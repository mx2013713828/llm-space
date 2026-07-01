export function createActiveJobRegistry(initialJobs) {
  const jobs = initialJobs instanceof Map ? initialJobs : new Map(initialJobs || []);

  return {
    reserve(harnessId, initial = {}) {
      const existing = jobs.get(harnessId);
      if (existing) {
        return { reserved: false, job: existing };
      }
      const job = {
        executor: initial.executor ?? null,
        clients: initial.clients instanceof Set ? initial.clients : new Set(initial.clients || []),
        source: initial.source,
      };
      jobs.set(harnessId, job);
      return { reserved: true, job };
    },

    set(harnessId, job) {
      jobs.set(harnessId, job);
      return this;
    },

    get(harnessId) {
      return jobs.get(harnessId);
    },

    has(harnessId) {
      return jobs.has(harnessId);
    },

    delete(harnessId) {
      return jobs.delete(harnessId);
    },

    attach(harnessId, client) {
      const job = jobs.get(harnessId);
      if (!job) return null;
      job.clients.add(client);
      return job;
    },

    detach(harnessId, client) {
      const job = jobs.get(harnessId);
      if (!job) return false;
      return job.clients.delete(client);
    },

    setExecutor(harnessId, executor) {
      const job = jobs.get(harnessId);
      if (!job) return null;
      job.executor = executor;
      return job;
    },

    broadcast(harnessId, type, data, send) {
      const job = jobs.get(harnessId);
      if (!job) return 0;
      let sent = 0;
      for (const client of job.clients) {
        try {
          send(client, type, data);
          sent += 1;
        } catch {
          // Closed SSE clients are removed by their close handlers.
        }
      }
      return sent;
    },

    release(harnessId, { endClients = true } = {}) {
      const job = jobs.get(harnessId);
      if (!job) return null;
      for (const client of job.clients) {
        if (endClients) client.end?.();
      }
      job.clients.clear();
      jobs.delete(harnessId);
      return job;
    },

    list() {
      return Array.from(jobs.entries()).map(([harnessId, job]) => ({
        harnessId,
        source: job.source,
        clientCount: job.clients?.size || 0,
        hasExecutor: Boolean(job.executor),
      }));
    },

    entries() {
      return jobs.entries();
    },

    values() {
      return jobs.values();
    },

    get size() {
      return jobs.size;
    },
  };
}
