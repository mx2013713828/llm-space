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

export function getApiToken(options = {}) {
  return options.apiToken || import.meta.env?.VITE_LLM_SPACE_API_TOKEN || '';
}

function buildFetchOptions(options = {}) {
  const {
    apiToken,
    baseUrl,
    headers,
    ...fetchOptions
  } = options;
  const token = getApiToken({ apiToken });

  if (!token) {
    return headers ? { ...fetchOptions, headers } : fetchOptions;
  }

  const nextHeaders = new Headers(headers || {});
  if (!nextHeaders.has('authorization') && !nextHeaders.has('x-llm-space-token')) {
    nextHeaders.set('x-llm-space-token', token);
  }
  return { ...fetchOptions, headers: nextHeaders };
}

export function apiFetch(path, options = {}, fetchImpl = fetch) {
  return fetchImpl(apiUrl(path, options), buildFetchOptions(options));
}
