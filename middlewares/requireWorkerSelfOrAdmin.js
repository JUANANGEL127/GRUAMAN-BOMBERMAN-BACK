import { AUTH_ERROR_CODES, createAuthError, sendAuthError } from "../errors/authErrors.js";

function isAdmin(user) {
  return user?.actorType === "admin" || user?.roles?.some((role) => role.startsWith("admin:"));
}

/**
 * Allows admins to access any subject and workers to access only their own worker identity.
 * Missing subject values are ignored so the endpoint handler can preserve its own 400 contract.
 * @param {(req: import("express").Request) => string | undefined | null} getSubject
 * @returns {import("express").RequestHandler}
 */
export function requireWorkerSelfOrAdmin(getSubject) {
  return function requireWorkerSelfOrAdminMiddleware(req, res, next) {
    const user = req.auth?.user;
    const subject = getSubject(req);

    if (!subject || isAdmin(user)) {
      return next();
    }

    if (
      user?.actorType === "worker" &&
      String(user.numeroIdentificacion) === String(subject)
    ) {
      return next();
    }

    return sendAuthError(res, createAuthError(AUTH_ERROR_CODES.FORBIDDEN));
  };
}
