function getDbClient(dbOrFactory) {
  if (typeof dbOrFactory === "function") {
    const resolvedDb = dbOrFactory();
    if (!resolvedDb) throw new Error("DB no disponible");
    return resolvedDb;
  }

  if (!dbOrFactory) {
    throw new Error("DB no disponible");
  }

  return dbOrFactory;
}

function mapTemporalMotiveRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    codigo: row.codigo,
    nombre: row.nombre,
    tipo: row.tipo,
    remunerada_default: row.remunerada_default === true,
    activo: row.activo === true,
    orden: row.orden == null ? null : Number(row.orden),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null
  };
}

function formatOrderValue(value) {
  return value == null ? null : Number(value);
}

export function createTemporalMotiveCatalogRepository({ db }) {
  function query(text, params) {
    const client = getDbClient(db);
    return client.query(text, params);
  }

  async function createTemporalMotive({
    codigo,
    nombre,
    tipo,
    remuneradaDefault,
    activo = true,
    orden = null
  }) {
    const result = await query(
      `INSERT INTO temporal_motives_catalog (
         codigo,
         nombre,
         tipo,
         remunerada_default,
         activo,
         orden
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at`,
      [codigo, nombre, tipo, remuneradaDefault, activo, orden]
    );
    return mapTemporalMotiveRow(result.rows[0]);
  }

  async function findTemporalMotiveById(id) {
    const result = await query(
      `SELECT id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at
         FROM temporal_motives_catalog
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    return mapTemporalMotiveRow(result.rows[0]);
  }

  async function findActiveTemporalMotiveById(id) {
    const result = await query(
      `SELECT id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at
         FROM temporal_motives_catalog
        WHERE id = $1
          AND activo = true
        LIMIT 1`,
      [id]
    );
    return mapTemporalMotiveRow(result.rows[0]);
  }

  async function findTemporalMotiveByTipoAndCodigo(tipo, codigo) {
    const result = await query(
      `SELECT id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at
         FROM temporal_motives_catalog
        WHERE tipo = $1
          AND codigo = $2
        LIMIT 1`,
      [tipo, codigo]
    );
    return mapTemporalMotiveRow(result.rows[0]);
  }

  async function findDefaultTemporalMotiveByTipo(tipo) {
    const result = await query(
      `SELECT id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at
         FROM temporal_motives_catalog
        WHERE tipo = $1
          AND activo = true
        ORDER BY COALESCE(orden, 999999) ASC, id ASC
        LIMIT 1`,
      [tipo]
    );
    return mapTemporalMotiveRow(result.rows[0]);
  }

  async function listTemporalMotives() {
    const result = await query(
      `SELECT id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at
         FROM temporal_motives_catalog
        ORDER BY tipo ASC, COALESCE(orden, 999999) ASC, codigo ASC, id ASC`
    );
    return result.rows.map(mapTemporalMotiveRow);
  }

  async function updateTemporalMotive(id, { codigo, nombre, tipo, remuneradaDefault, activo, orden }) {
    const sets = [];
    const values = [];

    if (codigo !== undefined) {
      values.push(codigo);
      sets.push(`codigo = $${values.length}`);
    }
    if (nombre !== undefined) {
      values.push(nombre);
      sets.push(`nombre = $${values.length}`);
    }
    if (tipo !== undefined) {
      values.push(tipo);
      sets.push(`tipo = $${values.length}`);
    }
    if (remuneradaDefault !== undefined) {
      values.push(remuneradaDefault);
      sets.push(`remunerada_default = $${values.length}`);
    }
    if (activo !== undefined) {
      values.push(activo);
      sets.push(`activo = $${values.length}`);
    }
    if (orden !== undefined) {
      values.push(formatOrderValue(orden));
      sets.push(`orden = $${values.length}`);
    }

    values.push(id);
    const result = await query(
      `UPDATE temporal_motives_catalog
          SET ${sets.join(", ")},
              updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING id, codigo, nombre, tipo, remunerada_default, activo, orden, created_at, updated_at`,
      values
    );
    return mapTemporalMotiveRow(result.rows[0]);
  }

  async function activateTemporalMotive(id) {
    return updateTemporalMotive(id, { activo: true });
  }

  async function deactivateTemporalMotive(id) {
    return updateTemporalMotive(id, { activo: false });
  }

  return {
    createTemporalMotive,
    findTemporalMotiveById,
    findActiveTemporalMotiveById,
    findTemporalMotiveByTipoAndCodigo,
    findDefaultTemporalMotiveByTipo,
    listTemporalMotives,
    updateTemporalMotive,
    activateTemporalMotive,
    deactivateTemporalMotive
  };
}
