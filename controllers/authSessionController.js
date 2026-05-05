import { AUTH_ERROR_CODES, sendAuthError } from "../errors/authErrors.js";
import { clearAuthCookies, writeAuthCookies } from "../helpers/authCookies.js";

export function createAuthSessionController({ authSessionService, authConfig }) {
  async function validateOrRefresh(req, res) {
    try {
      return await authSessionService.validateAccessToken(
        req.cookies?.[authConfig.cookies.accessName]
      );
    } catch (error) {
      if (
        error.code === AUTH_ERROR_CODES.TOKEN_EXPIRED &&
        req.cookies?.[authConfig.cookies.refreshName]
      ) {
        const refreshed = await authSessionService.refreshSession(
          req.cookies[authConfig.cookies.refreshName]
        );
        writeAuthCookies(res, authConfig, refreshed);
        return refreshed;
      }
      throw error;
    }
  }

  return {
    async getSession(req, res) {
      try {
        const result = await validateOrRefresh(req, res);
        return res.json({
          authenticated: true,
          user: result.user,
          session: result.session
        });
      } catch (error) {
        clearAuthCookies(res, authConfig);
        return sendAuthError(res, error);
      }
    },

    async refresh(req, res) {
      try {
        const result = await authSessionService.refreshSession(
          req.cookies?.[authConfig.cookies.refreshName]
        );
        writeAuthCookies(res, authConfig, result);
        return res.json({
          authenticated: true,
          user: result.user,
          session: result.session
        });
      } catch (error) {
        clearAuthCookies(res, authConfig);
        return sendAuthError(res, error);
      }
    },

    async logout(req, res) {
      try {
        await authSessionService.revokeByCredentials({
          accessToken: req.cookies?.[authConfig.cookies.accessName],
          refreshToken: req.cookies?.[authConfig.cookies.refreshName]
        });
      } finally {
        clearAuthCookies(res, authConfig);
      }
      return res.json({ success: true });
    }
  };
}
