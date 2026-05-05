import { AUTH_ERROR_CODES, createAuthError, sendAuthError } from "../errors/authErrors.js";

export function requireRole(...requiredRoles) {
  return function requireRoleMiddleware(req, res, next) {
    const roles = req.auth?.user?.roles || [];
    if (requiredRoles.some((role) => roles.includes(role))) {
      return next();
    }
    return sendAuthError(res, createAuthError(AUTH_ERROR_CODES.FORBIDDEN));
  };
}
