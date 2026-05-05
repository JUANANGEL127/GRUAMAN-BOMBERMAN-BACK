export async function initializeAuthSessionSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id VARCHAR(100) PRIMARY KEY,
      actor_type VARCHAR(20) NOT NULL CHECK (actor_type IN ('admin', 'worker')),
      actor_id VARCHAR(100) NOT NULL,
      role VARCHAR(80),
      refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ,
      created_ip INET,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_actor ON auth_sessions (actor_type, actor_id)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions (expires_at)`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_revoked_at ON auth_sessions (revoked_at)`);
}

function mapSessionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    role: row.role,
    refreshTokenHash: row.refresh_token_hash,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastSeenAt: row.last_seen_at,
    createdIp: row.created_ip,
    userAgent: row.user_agent,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createAuthSessionRepository({ db }) {
  return {
    async create(session) {
      const result = await db.query(
        `INSERT INTO auth_sessions (
          id,
          actor_type,
          actor_id,
          role,
          refresh_token_hash,
          expires_at,
          created_ip,
          user_agent,
          last_seen_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::inet, $8, NOW())
        RETURNING *`,
        [
          session.id,
          session.actorType,
          String(session.actorId),
          session.role || null,
          session.refreshTokenHash,
          session.expiresAt,
          session.createdIp || null,
          session.userAgent || null
        ]
      );
      return mapSessionRow(result.rows[0]);
    },

    async findByJti(jti) {
      const result = await db.query("SELECT * FROM auth_sessions WHERE id = $1", [jti]);
      return mapSessionRow(result.rows[0]);
    },

    async findByRefreshHash(refreshTokenHash) {
      const result = await db.query(
        "SELECT * FROM auth_sessions WHERE refresh_token_hash = $1",
        [refreshTokenHash]
      );
      return mapSessionRow(result.rows[0]);
    },

    async rotateRefresh(jti, refreshTokenHash, expiresAt) {
      const result = await db.query(
        `UPDATE auth_sessions
         SET refresh_token_hash = $2,
             expires_at = $3,
             last_seen_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING *`,
        [jti, refreshTokenHash, expiresAt]
      );
      return mapSessionRow(result.rows[0]);
    },

    async touch(jti) {
      await db.query(
        "UPDATE auth_sessions SET last_seen_at = NOW(), updated_at = NOW() WHERE id = $1 AND revoked_at IS NULL",
        [jti]
      );
    },

    async revoke(jti) {
      const result = await db.query(
        `UPDATE auth_sessions
         SET revoked_at = COALESCE(revoked_at, NOW()), updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [jti]
      );
      return mapSessionRow(result.rows[0]);
    },

    async cleanupExpired() {
      const result = await db.query(
        "DELETE FROM auth_sessions WHERE expires_at < NOW() - INTERVAL '7 days' RETURNING id"
      );
      return result.rowCount;
    }
  };
}
