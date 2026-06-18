import { useCallback, useEffect, useState } from 'react';
import { Clock3, RefreshCw, Trash2 } from 'lucide-react';
import { cancelCronJob, fetchCronJobs } from '../lib/cronJobs.js';

function formatLastRun(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(status) {
  if (status === 'running') return 'Running';
  if (status === 'queued') return 'Queued';
  if (status === 'succeeded') return 'Succeeded';
  if (status === 'failed') return 'Failed';
  return 'Idle';
}

export function ScheduledTasksPanel({ harnessId }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removingId, setRemovingId] = useState('');

  const loadJobs = useCallback(async () => {
    if (!harnessId) return;
    setLoading(true);
    setError('');
    try {
      setJobs(await fetchCronJobs(harnessId));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [harnessId]);

  useEffect(() => {
    if (!harnessId) return undefined;
    let cancelled = false;
    const refresh = () => fetchCronJobs(harnessId)
      .then(data => {
        if (cancelled) return;
        setJobs(data);
        setError('');
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [harnessId]);

  const handleCancel = async (job) => {
    if (!confirm(`Cancel scheduled job "${job.id}"?`)) return;
    setRemovingId(job.id);
    setError('');
    try {
      await cancelCronJob(harnessId, job.id);
      setJobs(current => current.filter(item => item.id !== job.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId('');
    }
  };

  return (
    <div className="scheduled-panel">
      <div className="scheduled-toolbar">
        <div>
          <div className="scheduled-title">Scheduled Tasks</div>
          <div className="scheduled-count">{jobs.length} active definition{jobs.length === 1 ? '' : 's'}</div>
        </div>
        <button className="icon-btn scheduled-refresh" onClick={loadJobs} disabled={loading} title="Refresh scheduled tasks">
          <RefreshCw size={15} className={loading ? 'spin-icon' : ''} />
        </button>
      </div>

      {error && <div className="scheduled-error">{error}</div>}

      {!loading && jobs.length === 0 && !error && (
        <div className="empty-state">
          <Clock3 size={32} strokeWidth={1.5} className="scheduled-empty-icon" />
          <div className="empty-state-title">No Scheduled Tasks</div>
          <div className="empty-state-desc">Ask the agent to schedule a recurring task for this harness.</div>
        </div>
      )}

      <div className="scheduled-list">
        {jobs.map(job => (
          <div key={job.id} className="scheduled-row">
            <div className="scheduled-time">
              <Clock3 size={16} />
              <code>{job.cron}</code>
            </div>
            <div className="scheduled-main">
              <div className="scheduled-prompt">{job.prompt}</div>
              <div className="scheduled-meta">
                <span>{job.id}</span>
                <span>Last success: {formatLastRun(job.lastSucceededAt)}</span>
                <span>Runs: {job.runCount || 0}</span>
                {job.failureCount > 0 && <span>Failed: {job.failureCount}</span>}
              </div>
            </div>
            <div className="scheduled-flags">
              <span className={`scheduled-flag status-${job.status || 'idle'}`}>
                {statusLabel(job.status)}
              </span>
              <span className={`scheduled-flag ${job.recurring ? 'active' : ''}`}>
                {job.recurring ? 'Recurring' : 'One-shot'}
              </span>
              <span className={`scheduled-flag ${job.durable ? 'durable' : ''}`}>
                {job.durable ? 'Durable' : 'Session'}
              </span>
            </div>
            <button
              className="icon-btn scheduled-delete"
              onClick={() => handleCancel(job)}
              disabled={removingId === job.id}
              title="Cancel scheduled task"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
