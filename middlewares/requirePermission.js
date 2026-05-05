import { AUTH_ERROR_CODES, createAuthError, sendAuthError } from "../errors/authErrors.js";

function permissionMatches(grantedPermission, requiredPermission) {
  if (grantedPermission === requiredPermission) return true;
  if (!grantedPermission.endsWith(":*")) return false;
  const prefix = grantedPermission.slice(0, -1);
  return requiredPermission.startsWith(prefix);
}

export function requirePermission(...requiredPermissions) {
  return function requirePermissionMiddleware(req, res, next) {
    const permissions = req.auth?.user?.permissions || [];
    const allowed = requiredPermissions.some((requiredPermission) =>
      permissions.some((grantedPermission) =>
        permissionMatches(grantedPermission, requiredPermission)
      )
    );
    if (allowed) {
      return next();
    }
    return sendAuthError(res, createAuthError(AUTH_ERROR_CODES.FORBIDDEN));
  };
}
