const API_BASE = 'http://localhost:3001';

async function readJson(res) {
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Request failed with status ${res.status}`);
  return data;
}

export async function fetchCronJobs(harnessId, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/api/harnesses/${encodeURIComponent(harnessId)}/cron-jobs`);
  return readJson(res);
}

export async function cancelCronJob(harnessId, jobId, fetchImpl = fetch) {
  const res = await fetchImpl(
    `${API_BASE}/api/harnesses/${encodeURIComponent(harnessId)}/cron-jobs/${encodeURIComponent(jobId)}`,
    { method: 'DELETE' }
  );
  return readJson(res);
}
