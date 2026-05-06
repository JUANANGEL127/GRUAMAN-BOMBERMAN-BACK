import crypto from "crypto";
import jwt from "jsonwebtoken";
import { AuthConfigError } from "../config/authConfig.js";
import { AUTH_ERROR_CODES, createAuthError } from "../errors/authErrors.js";

const ADMIN_ROLE_PREFIX = "admin";

function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1000);
}

function hashRefreshToken(refreshToken) {
  return crypto.createHash("sha256").update(refreshToken, "utf8").digest("hex");
}

function createOpaqueToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function normalizeActorId(value) {
  return String(value);
}

function mapAdminUser(admin) {
  const adminRole = admin.rol || admin.role;
  return {
    id: normalizeActorId(admin.id),
    actorType: "admin",
    roles: [`${ADMIN_ROLE_PREFIX}:${adminRole}`],
    permissions: ["admin:read", `${ADMIN_ROLE_PREFIX}:${adminRole}:*`],
    adminId: admin.id,
    adminRole
  };
}

function mapWorkerUser(worker) {
  return {
    id: normalizeActorId(worker.id),
    actorType: "worker",
    roles: ["worker"],
    permissions: ["forms:create", "forms:read:self", "session:read"],
    numeroIdentificacion: worker.numero_identificacion,
    nombre: worker.nombre || null,
    empresaId: worker.empresa_id,
    empresaSlug: worker.empresa_slug || worker.empresa || null,
    obraId: worker.obra_id,
    cargo: worker.cargo || null
  };
}

function createAccessPayload(user) {
  return {
    sub: user.id,
    actorType: user.actorType,
    roles: user.roles,
    permissions: user.permissions,
    user
  };
}

function getRequestIp(request) {
  return request?.ip || request?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || null;
}

function getRequestUserAgent(request) {
  return request?.headers?.["user-agent"] || null;
}

export function createAuthSessionService({ db, sessionRepository, authConfig }) {
  function signAccessToken(user, jti) {
    try {
      return jwt.sign(createAccessPayload(user), authConfig.jwt.getSecret(), {
        expiresIn: authConfig.jwt.accessTtlSeconds,
        issuer: authConfig.jwt.issuer,
        audience: authConfig.jwt.audience,
        jwtid: jti
      });
    } catch (error) {
      if (error instanceof AuthConfigError) {
        throw createAuthError(AUTH_ERROR_CODES.CONFIG_MISSING, { status: 500 });
      }
      throw error;
    }
  }

  async function loadActorUser(actorType, actorId, role) {
    if (actorType === "admin") {
      const result = await db.query(
        "SELECT id, rol FROM admin_passwords WHERE id = $1",
        [actorId]
      );
      if (result.rows.length === 0) {
        throw createAuthError(AUTH_ERROR_CODES.USER_INACTIVE);
      }
      return mapAdminUser(result.rows[0]);
    }

    if (actorType === "worker") {
      const result = await db.query(
        `SELECT
           t.id,
           t.numero_identificacion,
           t.nombre,
           t.empresa_id,
           COALESCE(NULLIF(t.empresa, ''), e.nombre) AS empresa_slug,
           t.obra_id,
           t.cargo,
           t.activo
         FROM trabajadores t
         LEFT JOIN empresas e ON e.id = t.empresa_id
         WHERE t.id = $1`,
        [actorId]
      );
      const worker = result.rows[0];
      if (!worker || worker.activo === false) {
        throw createAuthError(AUTH_ERROR_CODES.USER_INACTIVE);
      }
      return mapWorkerUser(worker);
    }

    throw createAuthError(AUTH_ERROR_CODES.TOKEN_INVALID);
  }

  async function createSession({ user, role, request }) {
    const now = new Date();
    const jti = crypto.randomUUID();
    const refreshToken = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const refreshExpiresAt = addSeconds(now, authConfig.refresh.ttlSeconds);

    await sessionRepository.create({
      id: jti,
      actorType: user.actorType,
      actorId: user.id,
      role,
      refreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      createdIp: getRequestIp(request),
      userAgent: getRequestUserAgent(request)
    });

    const accessToken = signAccessToken(user, jti);
    return {
      accessToken,
      refreshToken,
      csrfToken,
      user,
      session: {
        id: jti,
        expiresAt: refreshExpiresAt.toISOString()
      }
    };
  }

  function verifyAccessToken(accessToken) {
    if (!accessToken) {
      throw createAuthError(AUTH_ERROR_CODES.TOKEN_MISSING);
    }

    try {
      return jwt.verify(accessToken, authConfig.jwt.getSecret(), {
        issuer: authConfig.jwt.issuer,
        audience: authConfig.jwt.audience
      });
    } catch (error) {
      if (error instanceof AuthConfigError) {
        throw createAuthError(AUTH_ERROR_CODES.CONFIG_MISSING, { status: 500 });
      }
      if (error.name === "TokenExpiredError") {
        throw createAuthError(AUTH_ERROR_CODES.TOKEN_EXPIRED);
      }
      throw createAuthError(AUTH_ERROR_CODES.TOKEN_INVALID);
    }
  }

  async function validateSessionRecord(jti) {
    if (!jti) {
      throw createAuthError(AUTH_ERROR_CODES.TOKEN_INVALID);
    }
    const session = await sessionRepository.findByJti(jti);
    if (!session) {
      throw createAuthError(AUTH_ERROR_CODES.TOKEN_INVALID);
    }
    if (session.revokedAt) {
      throw createAuthError(AUTH_ERROR_CODES.SESSION_REVOKED);
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      throw createAuthError(AUTH_ERROR_CODES.TOKEN_EXPIRED);
    }
    return session;
  }

  return {
    async issueAdminSession({ admin, request }) {
      const user = mapAdminUser(admin);
      return createSession({ user, role: user.adminRole, request });
    },

    async issueWorkerSession({ worker, request }) {
      if (!worker || worker.activo === false) {
        throw createAuthError(AUTH_ERROR_CODES.USER_INACTIVE);
      }
      const user = mapWorkerUser(worker);
      return createSession({ user, role: "worker", request });
    },

    async validateAccessToken(accessToken) {
      const payload = verifyAccessToken(accessToken);
      const session = await validateSessionRecord(payload.jti);
      const user = await loadActorUser(session.actorType, session.actorId, session.role);
      await sessionRepository.touch(session.id);
      return {
        user,
        session: {
          id: session.id,
          expiresAt: new Date(session.expiresAt).toISOString()
        }
      };
    },

    async refreshSession(refreshToken) {
      if (!refreshToken) {
        throw createAuthError(AUTH_ERROR_CODES.TOKEN_MISSING);
      }
      const session = await sessionRepository.findByRefreshHash(hashRefreshToken(refreshToken));
      if (!session) {
        throw createAuthError(AUTH_ERROR_CODES.TOKEN_INVALID);
      }
      if (session.revokedAt) {
        throw createAuthError(AUTH_ERROR_CODES.SESSION_REVOKED);
      }
      if (new Date(session.expiresAt).getTime() <= Date.now()) {
        throw createAuthError(AUTH_ERROR_CODES.TOKEN_EXPIRED);
      }

      const user = await loadActorUser(session.actorType, session.actorId, session.role);
      const nextRefreshToken = createOpaqueToken();
      const csrfToken = createOpaqueToken();
      const refreshExpiresAt = addSeconds(new Date(), authConfig.refresh.ttlSeconds);
      const rotatedSession = await sessionRepository.rotateRefresh(
        session.id,
        hashRefreshToken(nextRefreshToken),
        refreshExpiresAt
      );

      if (!rotatedSession) {
        throw createAuthError(AUTH_ERROR_CODES.SESSION_REVOKED);
      }

      return {
        accessToken: signAccessToken(user, session.id),
        refreshToken: nextRefreshToken,
        csrfToken,
        user,
        session: {
          id: session.id,
          expiresAt: refreshExpiresAt.toISOString()
        }
      };
    },

    async revokeByCredentials({ accessToken, refreshToken }) {
      let jti = null;
      if (accessToken) {
        const decoded = jwt.decode(accessToken);
        jti = decoded?.jti || null;
      }
      if (!jti && refreshToken) {
        const session = await sessionRepository.findByRefreshHash(hashRefreshToken(refreshToken));
        jti = session?.id || null;
      }
      if (jti) {
        await sessionRepository.revoke(jti);
      }
    },

    mapAdminUser,
    mapWorkerUser
  };
}
