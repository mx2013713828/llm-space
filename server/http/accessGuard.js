const LOCAL_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  'localhost',
]);

const DEFAULT_RATE_LIMIT_PATHS = [
  '/api/agent/run',
  '/api/models',
  '/api/harnesses',
  '/api/memory',
  '/api/sessions',
];

export function normalizeRemoteAddress(address) {
  const value = String(address || '').trim();
  if (value.startsWith('::ffff:')) {
    return value.slice('::ffff:'.length);
  }
  return value;
}

export function getRequestAddress(req) {
  return normalizeRemoteAddress(
    req.ip
      || req.socket?.remoteAddress
      || req.connection?.remoteAddress
      || ''
  );
}

export function isLocalAddress(address) {
  return LOCAL_ADDRESSES.has(normalizeRemoteAddress(address));
}

export function isLocalRequest(req) {
  return isLocalAddress(getRequestAddress(req));
}

function getHeader(req, name) {
  const normalizedName = String(name || '').toLowerCase();
  if (typeof req.get === 'function') {
    const value = req.get(normalizedName);
    if (value) return value;
  }
  return req.headers?.[normalizedName];
}

export function extractAccessToken(req) {
  const explicitToken = getHeader(req, 'x-llm-space-token');
  if (explicitToken) return String(explicitToken).trim();

  const authorization = getHeader(req, 'authorization');
  const match = /^Bearer\s+(.+)$/i.exec(String(authorization || '').trim());
  return match ? match[1].trim() : '';
}

export function createAccessGuard({
  token = process.env.LLM_SPACE_API_TOKEN || '',
  allowLocal = true,
} = {}) {
  const configuredToken = String(token || '').trim();

  return function accessGuard(req, res, next) {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    if (allowLocal && isLocalRequest(req)) {
      next();
      return;
    }

    if (configuredToken && extractAccessToken(req) === configuredToken) {
      next();
      return;
    }

    res.status(403).json({
      error: 'Access denied: this local runtime API requires localhost access or a valid token.',
    });
  };
}

function pathMatches(reqPath, protectedPaths) {
  const normalizedPath = String(reqPath || '').split('?')[0];
  return protectedPaths.some((protectedPath) => (
    normalizedPath === protectedPath || normalizedPath.startsWith(`${protectedPath}/`)
  ));
}

export function createRateLimiter({
  windowMs = Number(process.env.LLM_SPACE_RATE_LIMIT_WINDOW_MS || 60_000),
  max = Number(process.env.LLM_SPACE_RATE_LIMIT_MAX || 120),
  paths = DEFAULT_RATE_LIMIT_PATHS,
  now = () => Date.now(),
  keyGenerator = getRequestAddress,
} = {}) {
  const buckets = new Map();
  const protectedPaths = Array.isArray(paths) ? paths : DEFAULT_RATE_LIMIT_PATHS;
  const safeWindowMs = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;
  const safeMax = Number.isFinite(max) && max >= 0 ? max : 120;

  return function rateLimiter(req, res, next) {
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const reqPath = req.path || req.originalUrl || req.url || '';
    if (!pathMatches(reqPath, protectedPaths)) {
      next();
      return;
    }

    const currentTime = now();
    const key = `${keyGenerator(req) || 'unknown'}:${req.method || 'GET'}:${String(reqPath).split('?')[0]}`;
    const bucket = buckets.get(key);

    if (!bucket || currentTime >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: currentTime + safeWindowMs });
      next();
      return;
    }

    if (bucket.count < safeMax) {
      bucket.count += 1;
      next();
      return;
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - currentTime) / 1000));
    res.setHeader?.('Retry-After', String(retryAfterSeconds));
    res.status(429).json({
      error: 'Rate limit exceeded. Please retry later.',
      retryAfterSeconds,
    });
  };
}
