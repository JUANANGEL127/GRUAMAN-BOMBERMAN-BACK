function parseCookieNames(cookieHeader) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter(Boolean);
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").toLowerCase());
}

function parseDebugPaths(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesDebugPath(pathname, paths) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isAuthDebugEnabled(env = process.env) {
  return isEnabled(env.AUTH_DEBUG_REQUESTS);
}

export function createAuthDebugLogger({
  enabled = isAuthDebugEnabled(),
  paths = parseDebugPaths(process.env.AUTH_DEBUG_PATHS).length
    ? parseDebugPaths(process.env.AUTH_DEBUG_PATHS)
    : ["/horas_jornada", "/obras", "/auth", "/webauthn"]
} = {}) {
  return function authDebugLogger(req, res, next) {
    if (!enabled || !matchesDebugPath(req.path, paths)) {
      return next();
    }

    const cookieNames = parseCookieNames(req.get("cookie"));
    const isPreflight = req.method === "OPTIONS";
    const requestInfo = {
      method: req.method,
      path: req.originalUrl,
      origin: req.get("origin") || null,
      isPreflight,
      accessControlRequestMethod: req.get("access-control-request-method") || null,
      accessControlRequestHeaders: req.get("access-control-request-headers") || null,
      hasCookieHeader: Boolean(req.get("cookie")),
      cookieNames,
      hasCsrfHeader: Boolean(req.get("x-csrf-token"))
    };

    console.info("[AUTH_DEBUG][request]", requestInfo);

    res.on("finish", () => {
      console.info("[AUTH_DEBUG][response]", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode
      });
    });

    return next();
  };
}
