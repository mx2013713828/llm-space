import { apiUrl } from './apiClient.js';

export async function fetchHarnessSession(harnessId, fetchImpl = fetch) {
  const res = await fetchImpl(apiUrl(`/api/sessions/${encodeURIComponent(harnessId)}`));
  if (!res.ok) throw new Error(`Failed to load session (${res.status})`);
  return res.json();
}
