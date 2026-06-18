function getDbClient(dbOrFactory) {
  if (typeof dbOrFactory === "function") {
    const resolvedDb = dbOrFactory();
    if (!resolvedDb) {
      throw new Error("DB no disponible");
    }
    return resolvedDb;
  }

  if (!dbOrFactory) {
    throw new Error("DB no disponible");
  }

  return dbOrFactory;
}

function normalizeRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    title: row.title,
    enabled: Boolean(row.enabled),
    permanent: Boolean(row.permanent),
    startsAt: row.starts_at ?? row.startsAt ?? null,
    endsAt: row.ends_at ?? row.endsAt ?? null,
    archivedAt: row.archived_at ?? row.archivedAt ?? null,
    storageProvider: row.storage_provider ?? row.storageProvider ?? null,
    storageKey: row.storage_key ?? row.storageKey ?? null,
    imageUrl: row.image_url ?? row.imageUrl ?? null,
    originalName: row.original_name ?? row.originalName ?? null,
    mimeType: row.mime_type ?? row.mimeType ?? null,
    size: row.size == null ? null : Number(row.size),
    createdAt: row.created_at ?? row.createdAt ?? null,
    updatedAt: row.updated_at ?? row.updatedAt ?? null
  };
}

function createRepositoryApi(client) {
  function query(text, params) {
    return client.query(text, params);
  }

  return {
    async findById(id) {
      const result = await query(`SELECT * FROM campaigns WHERE id = $1`, [id]);
      return normalizeRow(result.rows[0]);
    },

    async listCampaigns() {
      const result = await query(`SELECT * FROM campaigns ORDER BY id DESC`);
      return result.rows.map(normalizeRow);
    },

    async findActiveCampaign(referenceDate) {
      const result = await query(
        `SELECT *
         FROM campaigns
         WHERE enabled = TRUE
           AND archived_at IS NULL
           AND (
             permanent = TRUE
             OR ($1::date >= starts_at AND $1::date <= ends_at)
           )
         ORDER BY permanent DESC, starts_at ASC, id DESC
         LIMIT 1`,
        [referenceDate]
      );
      return normalizeRow(result.rows[0]);
    },

    async findConflictingEffectiveCampaign({ excludeId = null, permanent, startsAt, endsAt }) {
      const result = await query(
        `SELECT *
         FROM campaigns
         WHERE enabled = TRUE
           AND archived_at IS NULL
           AND ($1::int IS NULL OR id <> $1)
           AND (
             $2::boolean = TRUE
             OR permanent = TRUE
             OR (starts_at <= $4::date AND ends_at >= $3::date)
           )
         ORDER BY id DESC
         LIMIT 1`,
        [excludeId, permanent, startsAt, endsAt]
      );
      return normalizeRow(result.rows[0]);
    },

    async createCampaign(campaign) {
      const result = await query(
        `INSERT INTO campaigns (
           title,
           enabled,
           permanent,
           starts_at,
           ends_at,
           archived_at,
           storage_provider,
           storage_key,
           image_url,
           original_name,
           mime_type,
           size
         ) VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
          campaign.title,
          campaign.enabled,
          campaign.permanent,
          campaign.startsAt || null,
          campaign.endsAt || null,
          campaign.archivedAt || null,
          campaign.storageProvider || null,
          campaign.storageKey || null,
          campaign.imageUrl || null,
          campaign.originalName || null,
          campaign.mimeType || null,
          campaign.size == null ? null : Number(campaign.size)
        ]
      );
      return normalizeRow(result.rows[0]);
    },

    async updateCampaign(id, campaign) {
      const result = await query(
        `UPDATE campaigns
         SET title = $2,
             enabled = $3,
             permanent = $4,
             starts_at = $5::date,
             ends_at = $6::date,
             archived_at = $7,
             storage_provider = $8,
             storage_key = $9,
             image_url = $10,
             original_name = $11,
             mime_type = $12,
             size = $13,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          campaign.title,
          campaign.enabled,
          campaign.permanent,
          campaign.startsAt || null,
          campaign.endsAt || null,
          campaign.archivedAt || null,
          campaign.storageProvider || null,
          campaign.storageKey || null,
          campaign.imageUrl || null,
          campaign.originalName || null,
          campaign.mimeType || null,
          campaign.size == null ? null : Number(campaign.size)
        ]
      );
      return normalizeRow(result.rows[0]);
    },

    async patchCampaignStatus(id, { enabled }) {
      const result = await query(
        `UPDATE campaigns
         SET enabled = $2,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, enabled]
      );
      return normalizeRow(result.rows[0]);
    },

    async archiveCampaign(id, archivedAt) {
      const result = await query(
        `UPDATE campaigns
         SET archived_at = $2,
             enabled = FALSE,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, archivedAt]
      );
      return normalizeRow(result.rows[0]);
    }
  };
}

export function initializeCampaignsSchema(db) {
  return db.query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      permanent BOOLEAN NOT NULL DEFAULT FALSE,
      starts_at DATE,
      ends_at DATE,
      archived_at TIMESTAMPTZ,
      storage_provider VARCHAR(80) NOT NULL,
      storage_key VARCHAR(255) NOT NULL UNIQUE,
      image_url TEXT NOT NULL,
      original_name TEXT,
      mime_type VARCHAR(120),
      size BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (permanent = TRUE OR (starts_at IS NOT NULL AND ends_at IS NOT NULL)),
      CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at <= ends_at)
    );
  `);
}

export function createCampaignsRepository({ db }) {
  const baseDb = getDbClient(db);
  const baseApi = createRepositoryApi(baseDb);

  return {
    ...baseApi,
    async transaction(work) {
      if (typeof baseDb.connect !== "function") {
        return work(baseApi);
      }

      const client = await baseDb.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('campaigns-intro-promo'))");
        const result = await work(createRepositoryApi(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Ignore rollback errors after the original failure.
        }
        throw error;
      } finally {
        client.release?.();
      }
    }
  };
}
