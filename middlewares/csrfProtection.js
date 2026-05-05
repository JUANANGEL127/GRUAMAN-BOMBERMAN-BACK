import { AUTH_ERROR_CODES, createAuthError, sendAuthError } from "../errors/authErrors.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function createCsrfProtection({ authConfig }) {
  return function csrfProtection(req, res, next) {
    if (!authConfig.csrf.enabled || !UNSAFE_METHODS.has(req.method)) {
      return next();
    }

    const cookieToken = req.cookies?.[authConfig.cookies.csrfName];
    const headerToken = req.get(authConfig.csrf.headerName);

    if (cookieToken && headerToken && cookieToken === headerToken) {
      return next();
    }

    return sendAuthError(
      res,
      createAuthError(AUTH_ERROR_CODES.FORBIDDEN)
    );
  };
}
