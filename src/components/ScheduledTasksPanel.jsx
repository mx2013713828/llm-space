import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, History, LoaderCircle, RefreshCw, Trash2, X, XCircle } from 'lucide-react';
import { cancelCronJob, fetchCronJobs, fetchCronRuns } from '../lib/cronJobs.js';
import { formatRunDuration, getRunStatusLabel } from '../lib/cronRunPresentation.js';

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
  const [selectedJobId, setSelectedJobId] = useState('');
  const [runs, setRuns] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

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

  const loadRuns = useCallback(async (jobId, showLoading = true) => {
    if (!harnessId || !jobId) return;
    if (showLoading) setHistoryLoading(true);
    setHistoryError('');
    try {
      setRuns(await fetchCronRuns(harnessId, { jobId, limit: 25 }));
    } catch (err) {
      setHistoryError(err.message);
    } finally {
      if (showLoading) setHistoryLoading(false);
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

  useEffect(() => {
    if (!selectedJobId) return undefined;
    const initialTimer = setTimeout(() => loadRuns(selectedJobId), 0);
    const timer = setInterval(() => loadRuns(selectedJobId, false), 3000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [selectedJobId, loadRuns]);

  const handleCancel = async (job) => {
    if (!confirm(`Cancel scheduled job "${job.id}"?`)) return;
    setRemovingId(job.id);
    setError('');
    try {
      await cancelCronJob(harnessId, job.id);
      setJobs(current => current.filter(item => item.id !== job.id));
      if (selectedJobId === job.id) setSelectedJobId('');
    } catch (err) {
      setError(err.message);
    } finally {
      setRemovingId('');
    }
  };

  const selectedJob = jobs.find(job => job.id === selectedJobId);

  const closeHistory = () => {
    setSelectedJobId('');
    setRuns([]);
    setHistoryError('');
  };

  const toggleHistory = (jobId) => {
    if (selectedJobId === jobId) {
      closeHistory();
    } else {
      setRuns([]);
      setSelectedJobId(jobId);
    }
  };

  const runIcon = (status) => {
    if (status === 'succeeded') return <CheckCircle2 size={15} />;
    if (status === 'failed') return <XCircle size={15} />;
    if (status === 'interrupted') return <AlertTriangle size={15} />;
    return <LoaderCircle size={15} className={status === 'running' ? 'spin-icon' : ''} />;
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
              className={`icon-btn scheduled-history-button ${selectedJobId === job.id ? 'active' : ''}`}
              onClick={() => toggleHistory(job.id)}
              title="View execution history"
            >
              <History size={15} />
            </button>
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

      {selectedJobId && (
        <section className="scheduled-history" aria-label="Scheduled execution history">
          <div className="scheduled-history-header">
            <div>
              <div className="scheduled-history-title">Execution History</div>
              <div className="scheduled-history-job">{selectedJob?.prompt || selectedJobId}</div>
            </div>
            <div className="scheduled-history-actions">
              <button
                className="icon-btn"
                onClick={() => loadRuns(selectedJobId)}
                disabled={historyLoading}
                title="Refresh execution history"
              >
                <RefreshCw size={14} className={historyLoading ? 'spin-icon' : ''} />
              </button>
              <button className="icon-btn" onClick={closeHistory} title="Close execution history">
                <X size={15} />
              </button>
            </div>
          </div>

          {historyError && <div className="scheduled-error">{historyError}</div>}
          {!historyLoading && !historyError && runs.length === 0 && (
            <div className="scheduled-history-empty">No executions recorded yet.</div>
          )}

          <div className="scheduled-run-list">
            {runs.map(run => (
              <div className={`scheduled-run status-${run.status}`} key={run.id}>
                <div className="scheduled-run-status">
                  {runIcon(run.status)}
                  <span>{getRunStatusLabel(run.status)}</span>
                </div>
                <div className="scheduled-run-time">
                  <span>{formatLastRun(run.startedAt)}</span>
                  {run.error && <span className="scheduled-run-error">{run.error}</span>}
                </div>
                <code className="scheduled-run-duration">{formatRunDuration(run.durationMs)}</code>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
