export const AUTH_ERROR_CODES = Object.freeze({
  TOKEN_MISSING: "AUTH_TOKEN_MISSING",
  TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
  TOKEN_INVALID: "AUTH_TOKEN_INVALID",
  SESSION_REVOKED: "AUTH_SESSION_REVOKED",
  USER_INACTIVE: "AUTH_USER_INACTIVE",
  FORBIDDEN: "AUTH_FORBIDDEN",
  CONFIG_MISSING: "AUTH_CONFIG_MISSING"
});

const DEFAULT_MESSAGES = Object.freeze({
  [AUTH_ERROR_CODES.TOKEN_MISSING]: "Unauthorized",
  [AUTH_ERROR_CODES.TOKEN_EXPIRED]: "Unauthorized",
  [AUTH_ERROR_CODES.TOKEN_INVALID]: "Unauthorized",
  [AUTH_ERROR_CODES.SESSION_REVOKED]: "Unauthorized",
  [AUTH_ERROR_CODES.USER_INACTIVE]: "Unauthorized",
  [AUTH_ERROR_CODES.FORBIDDEN]: "Forbidden",
  [AUTH_ERROR_CODES.CONFIG_MISSING]: "Authentication is not configured"
});

export function createAuthError(code, options = {}) {
  const status = code === AUTH_ERROR_CODES.FORBIDDEN ? 403 : options.status || 401;
  const error = new Error(options.message || DEFAULT_MESSAGES[code] || "Unauthorized");
  error.name = "AuthError";
  error.code = code;
  error.status = status;
  return error;
}

export function isAuthError(error) {
  return error?.name === "AuthError" && typeof error.code === "string";
}

export function authErrorBody(code, message = DEFAULT_MESSAGES[code] || "Unauthorized") {
  return {
    success: false,
    error: {
      code,
      message
    }
  };
}

export function sendAuthError(res, error) {
  const code = isAuthError(error) ? error.code : AUTH_ERROR_CODES.TOKEN_INVALID;
  const status = isAuthError(error) ? error.status : 401;
  const message = status === 403 ? "Forbidden" : DEFAULT_MESSAGES[code] || "Unauthorized";
  return res.status(status).json(authErrorBody(code, message));
}
