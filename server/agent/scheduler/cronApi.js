function validHarnessId(harnessId) {
  return typeof harnessId === 'string' && /^[a-zA-Z0-9_-]+$/.test(harnessId);
}

export function createCronApiHandlers(scheduler) {
  return {
    async list(req, res) {
      const { harnessId } = req.params;
      if (!validHarnessId(harnessId)) {
        return res.status(400).json({ error: 'Invalid harness ID' });
      }
      return res.json(scheduler.listJobs(harnessId));
    },

    async create(req, res) {
      const { harnessId } = req.params;
      if (!validHarnessId(harnessId)) {
        return res.status(400).json({ error: 'Invalid harness ID' });
      }
      try {
        const job = await scheduler.scheduleJob({
          harnessId,
          cron: req.body?.cron,
          prompt: req.body?.prompt,
          recurring: req.body?.recurring !== false,
          durable: req.body?.durable !== false,
          modelRef: req.body?.modelRef || null,
          executionMode: 'main'
        });
        return res.status(201).json(job);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    },

    async remove(req, res) {
      const { harnessId, jobId } = req.params;
      if (!validHarnessId(harnessId)) {
        return res.status(400).json({ error: 'Invalid harness ID' });
      }
      const removed = await scheduler.cancelJob(jobId, harnessId);
      if (!removed) {
        return res.status(404).json({ error: 'Scheduled job not found' });
      }
      return res.json({ success: true });
    }
  };
}
