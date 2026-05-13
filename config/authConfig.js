const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_FRONTEND_URL = "https://gruaman-bomberman-front.onrender.com";

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function normalizeSameSite(value) {
  const normalized = String(value || "lax").toLowerCase();
  if (["lax", "strict", "none"].includes(normalized)) return normalized;
  return "lax";
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function isLocalhostOrigin(origin) {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export class AuthConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthConfigError";
  }
}

export function createAuthConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";
  const secureCookies = parseBoolean(env.AUTH_COOKIE_SECURE, isProduction);
  const sameSite = normalizeSameSite(env.AUTH_COOKIE_SAMESITE || "lax");
  const csrfEnabled = parseBoolean(env.AUTH_CSRF_ENABLED, false);
  const allowLocalhostCors = parseBoolean(env.CORS_ALLOW_LOCALHOST, !isProduction);
  const fallbackOrigins = isProduction ? [] : [DEFAULT_FRONTEND_URL];
  const configuredCorsOrigins = unique([
    ...parseCsvList(env.CORS_ALLOWED_ORIGINS),
    env.FRONTEND_URL || DEFAULT_FRONTEND_URL,
    ...fallbackOrigins
  ]).filter((origin) => allowLocalhostCors || !isLocalhostOrigin(origin));

  if (sameSite === "none" && !secureCookies) {
    throw new AuthConfigError(
      "AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true"
    );
  }

  if (sameSite === "none" && !csrfEnabled) {
    throw new AuthConfigError(
      "AUTH_COOKIE_SAMESITE=none requires AUTH_CSRF_ENABLED=true"
    );
  }

  return {
    jwt: {
      issuer: env.AUTH_JWT_ISSUER || "gruaman-bomberman-back",
      audience: env.AUTH_JWT_AUDIENCE || "gruaman-bomberman-front",
      accessTtlSeconds: parsePositiveInteger(env.AUTH_ACCESS_TTL_SECONDS, DEFAULT_ACCESS_TTL_SECONDS),
      getSecret() {
        const secret = env.AUTH_JWT_SECRET || env.JWT_SECRET;
        if (!secret) {
          throw new AuthConfigError("AUTH_JWT_SECRET is required to issue or verify sessions");
        }
        return secret;
      }
    },
    refresh: {
      ttlSeconds: parsePositiveInteger(env.AUTH_REFRESH_TTL_SECONDS, DEFAULT_REFRESH_TTL_SECONDS)
    },
    cookies: {
      accessName: env.AUTH_ACCESS_COOKIE_NAME || "gm_access",
      refreshName: env.AUTH_REFRESH_COOKIE_NAME || "gm_refresh",
      csrfName: env.AUTH_CSRF_COOKIE_NAME || "gm_csrf",
      secure: secureCookies,
      sameSite,
      accessPath: env.AUTH_ACCESS_COOKIE_PATH || "/",
      refreshPath: env.AUTH_REFRESH_COOKIE_PATH || "/auth",
      csrfPath: env.AUTH_CSRF_COOKIE_PATH || "/"
    },
    csrf: {
      enabled: csrfEnabled,
      headerName: env.AUTH_CSRF_HEADER_NAME || "x-csrf-token"
    },
    cors: {
      frontendUrl: env.FRONTEND_URL || DEFAULT_FRONTEND_URL,
      allowedOrigins: configuredCorsOrigins,
      allowLocalhost: allowLocalhostCors
    }
  };
}
