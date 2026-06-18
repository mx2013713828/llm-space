const API_BASE = 'http://localhost:3001';

export async function fetchHarnessSession(harnessId, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/api/sessions/${encodeURIComponent(harnessId)}`);
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  return res.json();
}
