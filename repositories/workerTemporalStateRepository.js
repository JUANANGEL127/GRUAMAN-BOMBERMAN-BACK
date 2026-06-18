const BOGOTA_TODAY_EXPR = "((NOW() AT TIME ZONE 'America/Bogota')::date)";

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

function formatDateOnly(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const date = input;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  const value = String(input).trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return value;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function mapTemporalStateRow(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    trabajador_id: Number(row.trabajador_id),
    tipo: row.tipo,
    motivo: row.motivo_nombre_snapshot || row.motivo_catalogo_nombre || row.motivo,
    motivo_catalogo_id: row.motivo_catalogo_id == null ? null : Number(row.motivo_catalogo_id),
    motivo_codigo_snapshot: row.motivo_codigo_snapshot || null,
    motivo_nombre_snapshot: row.motivo_nombre_snapshot || null,
    motivo_tipo_snapshot: row.motivo_tipo_snapshot || null,
    motivo_remunerada_snapshot: row.motivo_remunerada_snapshot == null ? null : row.motivo_remunerada_snapshot === true,
    remunerada: row.remunerada === true,
    fecha_inicio: formatDateOnly(row.fecha_inicio),
    fecha_fin: formatDateOnly(row.fecha_fin),
    cerrado_at: row.cerrado_at || null,
    cerrado_by: row.cerrado_by == null ? null : Number(row.cerrado_by),
    created_by: row.created_by == null ? null : Number(row.created_by),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    anulado_at: row.anulado_at || null,
    anulado_by: row.anulado_by == null ? null : Number(row.anulado_by),
    anulado_motivo: row.anulado_motivo || null,
    vigente_hoy: row.vigente_hoy === true,
    excluye_indicador_central: row.excluye_indicador_central === true
  };
}

function baseSelectColumns(extraColumns = "") {
  return `
      SELECT t.id,
             t.trabajador_id,
             t.tipo,
             t.motivo,
             t.motivo_catalogo_id,
             t.motivo_codigo_snapshot,
             t.motivo_nombre_snapshot,
             t.motivo_tipo_snapshot,
             t.motivo_remunerada_snapshot,
             t.remunerada,
             t.fecha_inicio,
             t.fecha_fin,
             t.cerrado_at,
             t.cerrado_by,
             t.created_by,
             t.created_at,
             t.updated_at,
             t.anulado_at,
             t.anulado_by,
             t.anulado_motivo,
             tm.codigo AS motivo_catalogo_codigo,
             tm.nombre AS motivo_catalogo_nombre,
             ${extraColumns}
        FROM trabajador_estado_temporal t
        LEFT JOIN temporal_motives_catalog tm ON tm.id = t.motivo_catalogo_id
    `;
}

function buildActiveTemporalStateColumns({ cutoffSql = BOGOTA_TODAY_EXPR, parameterized = false } = {}) {
  if (parameterized) {
    return `(
      t.fecha_inicio <= $2::date
      AND COALESCE(t.fecha_fin, 'infinity'::date) >= $2::date
      AND t.cerrado_at IS NULL
      AND t.anulado_at IS NULL
    ) AS vigente_hoy,
    (
      t.fecha_inicio <= $2::date
      AND COALESCE(t.fecha_fin, 'infinity'::date) >= $2::date
      AND t.cerrado_at IS NULL
      AND t.anulado_at IS NULL
    ) AS excluye_indicador_central`;
  }

  return `(
      t.fecha_inicio <= ${cutoffSql}
      AND COALESCE(t.fecha_fin, 'infinity'::date) >= ${cutoffSql}
      AND t.cerrado_at IS NULL
      AND t.anulado_at IS NULL
    ) AS vigente_hoy,
    (
      t.fecha_inicio <= ${cutoffSql}
      AND COALESCE(t.fecha_fin, 'infinity'::date) >= ${cutoffSql}
      AND t.cerrado_at IS NULL
      AND t.anulado_at IS NULL
    ) AS excluye_indicador_central`;
}

export function createWorkerTemporalStateRepository({ db }) {
  function query(text, params) {
    const client = getDbClient(db);
    return client.query(text, params);
  }

  async function findWorkerById(workerId) {
    const result = await query(
      `SELECT id, nombre, activo, empresa_id, numero_identificacion
         FROM trabajadores
        WHERE id = $1
        LIMIT 1`,
      [workerId]
    );
    return result.rows[0] || null;
  }

  async function findTemporalStateById(recordId) {
    const result = await query(
      `${baseSelectColumns(buildActiveTemporalStateColumns())}
        WHERE t.id = $1
        LIMIT 1`,
      [recordId]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function findTemporalStateByWorkerIdAtCutoff(workerId, cutoffDate) {
    const result = await query(
      `${baseSelectColumns(buildActiveTemporalStateColumns({ parameterized: true }))}
        WHERE t.trabajador_id = $1
          AND t.fecha_inicio <= $2::date
          AND COALESCE(t.fecha_fin, 'infinity'::date) >= $2::date
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.fecha_inicio DESC, t.id DESC
        LIMIT 1`,
      [workerId, cutoffDate]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function listTemporalStatesByWorkerId(workerId) {
    const result = await query(
      `${baseSelectColumns(buildActiveTemporalStateColumns())}
        WHERE t.trabajador_id = $1
        ORDER BY t.fecha_inicio DESC, t.id DESC`,
      [workerId]
    );
    return result.rows.map(mapTemporalStateRow);
  }

  async function listTemporalStatesByWorkerIdHistory(workerId) {
    return listTemporalStatesByWorkerId(workerId);
  }

  async function listTemporalStatesByWorkerIdAtCutoff(workerId, cutoffDate) {
    const result = await query(
      `${baseSelectColumns(buildActiveTemporalStateColumns({ parameterized: true }))}
        WHERE t.trabajador_id = $1
          AND t.fecha_inicio <= $2::date
          AND COALESCE(t.fecha_fin, 'infinity'::date) >= $2::date
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.fecha_inicio DESC, t.id DESC`,
      [workerId, cutoffDate]
    );
    return result.rows.map(mapTemporalStateRow);
  }

  async function findCurrentTemporalStateByWorkerId(workerId) {
    const result = await query(
      `${baseSelectColumns(buildActiveTemporalStateColumns())}
        WHERE t.trabajador_id = $1
          AND t.fecha_inicio <= ${BOGOTA_TODAY_EXPR}
          AND COALESCE(t.fecha_fin, 'infinity'::date) >= ${BOGOTA_TODAY_EXPR}
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.fecha_inicio DESC, t.id DESC
        LIMIT 1`,
      [workerId]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function findCurrentTemporalStateByWorkerIdAtCutoff(workerId, cutoffDate) {
    return findTemporalStateByWorkerIdAtCutoff(workerId, cutoffDate);
  }

  async function findNextTemporalStateByWorkerId(workerId) {
    const result = await query(
      `${baseSelectColumns(`false AS vigente_hoy,
             false AS excluye_indicador_central`)}
        WHERE t.trabajador_id = $1
          AND t.fecha_inicio > ${BOGOTA_TODAY_EXPR}
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.fecha_inicio ASC, t.id ASC
        LIMIT 1`,
      [workerId]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function findNextTemporalStateByWorkerIdAtCutoff(workerId, cutoffDate) {
    const result = await query(
      `${baseSelectColumns(`false AS vigente_hoy,
             false AS excluye_indicador_central`)}
        WHERE t.trabajador_id = $1
          AND t.fecha_inicio > $2::date
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.fecha_inicio ASC, t.id ASC
        LIMIT 1`,
      [workerId, cutoffDate]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function findCurrentTemporalStatesByWorkerIds(workerIds = []) {
    const ids = [...new Set(workerIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
    if (ids.length === 0) return new Map();

    const result = await query(
      `SELECT DISTINCT ON (t.trabajador_id)
              t.id,
              t.trabajador_id,
              t.tipo,
              t.motivo,
              t.motivo_catalogo_id,
              t.motivo_codigo_snapshot,
              t.motivo_nombre_snapshot,
              t.motivo_tipo_snapshot,
              t.motivo_remunerada_snapshot,
              t.remunerada,
              t.fecha_inicio,
              t.fecha_fin,
              t.cerrado_at,
              t.cerrado_by,
              t.created_by,
              t.created_at,
              t.updated_at,
              t.anulado_at,
              t.anulado_by,
              t.anulado_motivo,
              tm.codigo AS motivo_catalogo_codigo,
              tm.nombre AS motivo_catalogo_nombre,
              true AS vigente_hoy,
              true AS excluye_indicador_central
         FROM trabajador_estado_temporal t
         LEFT JOIN temporal_motives_catalog tm ON tm.id = t.motivo_catalogo_id
        WHERE t.trabajador_id = ANY($1::int[])
          AND t.fecha_inicio <= ${BOGOTA_TODAY_EXPR}
          AND COALESCE(t.fecha_fin, 'infinity'::date) >= ${BOGOTA_TODAY_EXPR}
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.trabajador_id, t.fecha_inicio DESC, t.fecha_fin DESC NULLS LAST, t.id DESC`,
      [ids]
    );

    return new Map(result.rows.map((row) => [Number(row.trabajador_id), mapTemporalStateRow(row)]));
  }

  async function findCurrentTemporalStatesByWorkerIdsAtCutoff(workerIds = [], cutoffDate) {
    const ids = [...new Set(workerIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
    if (ids.length === 0) return new Map();

    const result = await query(
      `SELECT DISTINCT ON (t.trabajador_id)
              t.id,
              t.trabajador_id,
              t.tipo,
              t.motivo,
              t.motivo_catalogo_id,
              t.motivo_codigo_snapshot,
              t.motivo_nombre_snapshot,
              t.motivo_tipo_snapshot,
              t.motivo_remunerada_snapshot,
              t.remunerada,
              t.fecha_inicio,
              t.fecha_fin,
              t.cerrado_at,
              t.cerrado_by,
              t.created_by,
              t.created_at,
              t.updated_at,
              t.anulado_at,
              t.anulado_by,
              t.anulado_motivo,
              tm.codigo AS motivo_catalogo_codigo,
              tm.nombre AS motivo_catalogo_nombre,
              true AS vigente_hoy,
              true AS excluye_indicador_central
         FROM trabajador_estado_temporal t
         LEFT JOIN temporal_motives_catalog tm ON tm.id = t.motivo_catalogo_id
        WHERE t.trabajador_id = ANY($1::int[])
          AND t.fecha_inicio <= $2::date
          AND COALESCE(t.fecha_fin, 'infinity'::date) >= $2::date
          AND t.cerrado_at IS NULL
          AND t.anulado_at IS NULL
        ORDER BY t.trabajador_id, t.fecha_inicio DESC, t.fecha_fin DESC NULLS LAST, t.id DESC`,
      [ids, cutoffDate]
    );

    return new Map(result.rows.map((row) => [Number(row.trabajador_id), mapTemporalStateRow(row)]));
  }

  async function hasOverlappingTemporalState({ workerId, fechaInicio, fechaFin, excludeId = null }) {
    const values = [workerId, fechaInicio];
    let sql = `
      SELECT 1
        FROM trabajador_estado_temporal
       WHERE trabajador_id = $1
         AND fecha_inicio <= COALESCE($3::date, 'infinity'::date)
         AND COALESCE(fecha_fin, 'infinity'::date) >= $2::date
         AND cerrado_at IS NULL
         AND anulado_at IS NULL
         AND COALESCE(fecha_fin, 'infinity'::date) > CURRENT_DATE
    `;

    values.push(fechaFin || null);

    if (excludeId != null) {
      values.push(excludeId);
      sql += ` AND id <> $4`;
    }

    sql += ` LIMIT 1`;

    const result = await query(sql, values);
    return result.rows.length > 0;
  }

  async function createTemporalState({
    workerId,
    tipo,
    motivo = null,
    motivoId = null,
    motivoCodigoSnapshot = null,
    motivoNombreSnapshot = null,
    motivoTipoSnapshot = null,
    motivoRemuneradaSnapshot = null,
    remunerada,
    fechaInicio,
    fechaFin,
    createdBy = null
  }) {
    const result = await query(
      `INSERT INTO trabajador_estado_temporal (
         trabajador_id,
         tipo,
         motivo,
         motivo_catalogo_id,
         motivo_codigo_snapshot,
         motivo_nombre_snapshot,
         motivo_tipo_snapshot,
         motivo_remunerada_snapshot,
         remunerada,
         fecha_inicio,
         fecha_fin,
         created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, $11::date, $12)
       RETURNING id,
                 trabajador_id,
                 tipo,
                 motivo,
                 motivo_catalogo_id,
                 motivo_codigo_snapshot,
                 motivo_nombre_snapshot,
                 motivo_tipo_snapshot,
                 motivo_remunerada_snapshot,
                 remunerada,
                 fecha_inicio,
                 fecha_fin,
                 cerrado_at,
                 cerrado_by,
                 created_by,
                 created_at,
                 updated_at,
                 anulado_at,
                 anulado_by,
                 anulado_motivo`,
      [workerId, tipo, motivo, motivoId, motivoCodigoSnapshot, motivoNombreSnapshot, motivoTipoSnapshot, motivoRemuneradaSnapshot, remunerada, fechaInicio, fechaFin, createdBy]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function updateTemporalState(recordId, {
    tipo,
    motivo,
    remunerada,
    fechaInicio,
    fechaFin
  }) {
    const sets = [];
    const values = [];

    if (tipo !== undefined) {
      values.push(tipo);
      sets.push(`tipo = $${values.length}`);
    }
    if (motivo !== undefined) {
      values.push(motivo);
      sets.push(`motivo = $${values.length}`);
    }
    if (remunerada !== undefined) {
      values.push(remunerada);
      sets.push(`remunerada = $${values.length}`);
    }
    if (fechaInicio !== undefined) {
      values.push(fechaInicio);
      sets.push(`fecha_inicio = $${values.length}::date`);
    }
    if (fechaFin !== undefined) {
      values.push(fechaFin);
      sets.push(`fecha_fin = $${values.length}::date`);
    }

    values.push(recordId);

    const result = await query(
      `UPDATE trabajador_estado_temporal
          SET ${sets.join(", ")},
              updated_at = NOW()
        WHERE id = $${values.length}
        RETURNING id,
                  trabajador_id,
                  tipo,
                  motivo,
                  motivo_catalogo_id,
                  motivo_codigo_snapshot,
                  motivo_nombre_snapshot,
                  motivo_tipo_snapshot,
                  motivo_remunerada_snapshot,
                  remunerada,
                  fecha_inicio,
                  fecha_fin,
                  cerrado_at,
                  cerrado_by,
                  created_by,
                  created_at,
                  updated_at,
                  anulado_at,
                  anulado_by,
                  anulado_motivo`,
      values
    );

    return mapTemporalStateRow(result.rows[0]);
  }

  async function closeTemporalState(recordId, { cerradoAt, cerradoBy = null } = {}) {
    const result = await query(
      `UPDATE trabajador_estado_temporal
          SET cerrado_at = $2::timestamptz,
              cerrado_by = $3,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id,
                  trabajador_id,
                  tipo,
                  motivo,
                  motivo_catalogo_id,
                  motivo_codigo_snapshot,
                  motivo_nombre_snapshot,
                  motivo_tipo_snapshot,
                  motivo_remunerada_snapshot,
                  remunerada,
                  fecha_inicio,
                  fecha_fin,
                  cerrado_at,
                  cerrado_by,
                  created_by,
                  created_at,
                  updated_at,
                  anulado_at,
                  anulado_by,
                  anulado_motivo`,
      [recordId, cerradoAt, cerradoBy]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  async function anularTemporalState(recordId, { anuladoAt, anuladoBy = null, anuladoMotivo = null }) {
    const result = await query(
      `UPDATE trabajador_estado_temporal
          SET anulado_at = $2::timestamptz,
              anulado_by = $3,
              anulado_motivo = $4,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id,
                  trabajador_id,
                  tipo,
                  motivo,
                  motivo_catalogo_id,
                  motivo_codigo_snapshot,
                  motivo_nombre_snapshot,
                  motivo_tipo_snapshot,
                  motivo_remunerada_snapshot,
                  remunerada,
                  fecha_inicio,
                  fecha_fin,
                  cerrado_at,
                  cerrado_by,
                  created_by,
                  created_at,
                  updated_at,
                  anulado_at,
                  anulado_by,
                  anulado_motivo`,
      [recordId, anuladoAt, anuladoBy, anuladoMotivo]
    );
    return mapTemporalStateRow(result.rows[0]);
  }

  return {
    findWorkerById,
    findTemporalStateById,
    findTemporalStateByWorkerIdAtCutoff,
    listTemporalStatesByWorkerId,
    listTemporalStatesByWorkerIdHistory,
    listTemporalStatesByWorkerIdAtCutoff,
    findCurrentTemporalStateByWorkerId,
    findCurrentTemporalStateByWorkerIdAtCutoff,
    findNextTemporalStateByWorkerId,
    findNextTemporalStateByWorkerIdAtCutoff,
    findCurrentTemporalStatesByWorkerIds,
    findCurrentTemporalStatesByWorkerIdsAtCutoff,
    hasOverlappingTemporalState,
    createTemporalState,
    updateTemporalState,
    closeTemporalState,
    anularTemporalState
  };
}
