function splitPath(value) {
  return String(value || '').split('/').filter(Boolean);
}

function matchRoute(pattern, actualPath) {
  const patternParts = splitPath(pattern);
  const actualParts = splitPath(actualPath);
  if (patternParts.length !== actualParts.length) return null;

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index];
    const actualPart = actualParts[index];
    if (patternPart.startsWith(':')) {
      params[patternPart.slice(1)] = decodeURIComponent(actualPart);
      continue;
    }
    if (patternPart !== actualPart) return null;
  }
  return params;
}

export function createRouteApp() {
  const routes = [];
  const middleware = [];
  const app = {
    routes,
    middleware,
    use(handler) {
      middleware.push(handler);
    },
  };
  for (const method of ['get', 'post', 'put', 'delete']) {
    app[method] = (pattern, handler) => {
      routes.push({ method: method.toUpperCase(), pattern, handler });
    };
  }
  return app;
}

export async function dispatchJson(app, method, requestPath, { body = {}, query = {} } = {}) {
  const route = app.routes.find((candidate) => (
    candidate.method === method.toUpperCase() && matchRoute(candidate.pattern, requestPath)
  ));
  if (!route) {
    throw new Error(`No route registered for ${method.toUpperCase()} ${requestPath}`);
  }
  const params = matchRoute(route.pattern, requestPath);
  const req = { body, params, query };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await route.handler(req, res);
  return { status: res.statusCode, body: res.body };
}

export function findRouteHandler(app, method, requestPath) {
  const route = app.routes.find((candidate) => (
    candidate.method === method.toUpperCase() && matchRoute(candidate.pattern, requestPath)
  ));
  if (!route) {
    throw new Error(`No route registered for ${method.toUpperCase()} ${requestPath}`);
  }
  return {
    handler: route.handler,
    params: matchRoute(route.pattern, requestPath),
  };
}
