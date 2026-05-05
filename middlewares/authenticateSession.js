import { isAuthError, sendAuthError } from "../errors/authErrors.js";
import { isAuthDebugEnabled } from "./authDebugLogger.js";

export function createAuthenticateSession({ authSessionService, authConfig }) {
  return async function authenticateSession(req, res, next) {
    try {
      const result = await authSessionService.validateAccessToken(
        req.cookies?.[authConfig.cookies.accessName]
      );
      req.auth = result;
      return next();
    } catch (error) {
      if (isAuthDebugEnabled()) {
        console.warn("[AUTH_DEBUG][auth-failure]", {
          method: req.method,
          path: req.originalUrl,
          origin: req.get("origin") || null,
          code: isAuthError(error) ? error.code : "AUTH_UNKNOWN",
          hasCookieHeader: Boolean(req.get("cookie")),
          cookieNames: Object.keys(req.cookies || {})
        });
      }
      return sendAuthError(res, error);
    }
  };
}
