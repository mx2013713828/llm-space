export function formatRunDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 'In progress';
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60000) return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} s`;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.round((durationMs % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function getRunStatusLabel(status) {
  return {
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    interrupted: 'Interrupted'
  }[status] || 'Unknown';
}
