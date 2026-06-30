const DEFAULT_API_BASE = 'http://localhost:3001';

export function getApiBase(options = {}) {
  const configuredBase = options.baseUrl || import.meta.env?.VITE_API_BASE_URL || DEFAULT_API_BASE;
  return String(configuredBase).replace(/\/+$/, '');
}

export function apiUrl(path, options = {}) {
  const normalizedPath = String(path || '').startsWith('/')
    ? String(path || '')
    : `/${path || ''}`;

  return `${getApiBase(options)}${normalizedPath}`;
}

export function apiFetch(path, options = {}, fetchImpl = fetch) {
  return fetchImpl(apiUrl(path), options);
}
