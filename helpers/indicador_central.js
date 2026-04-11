import nodemailer from 'nodemailer';
import { DateTime } from 'luxon';
import { formatDateOnly, parseDateLocal, todayDateString } from './dateUtils.js';
import { generateIndicadorCentralWorkbookBuffer } from './indicador_central_excel.js';

export const INDICADOR_CENTRAL_TIMEZONE = 'America/Bogota';

const FORM_TABLE_META = {
  chequeo_alturas: { tabla: 'chequeo_alturas', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  chequeo_elevador: { tabla: 'chequeo_elevador', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  inspeccion_epcc: { tabla: 'inspeccion_epcc', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  inspeccion_izaje: { tabla: 'inspeccion_izaje', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  permiso_trabajo: { tabla: 'permiso_trabajo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  chequeo_torregruas: { tabla: 'chequeo_torregruas', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  horas_jornada: { tabla: 'horas_jornada', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  checklist: { tabla: 'checklist', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  inventario_obra: { tabla: 'inventario_obra', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
  planilla_bombeo: { tabla: 'planilla_bombeo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' }
};

const FORMATO_INGRESO = 'horas_jornada';
const DEFAULT_SCOPE_EMPRESA_IDS = [1, 2];

const DEFAULT_FORMATOS_POR_EMPRESA = {
  '1': ['chequeo_alturas', 'chequeo_elevador', 'inspeccion_epcc', 'inspeccion_izaje', 'permiso_trabajo', 'chequeo_torregruas', 'horas_jornada'],
  '2': ['inspeccion_epcc', 'permiso_trabajo', 'horas_jornada', 'checklist', 'inventario_obra', 'planilla_bombeo', 'chequeo_alturas']
};

const PROJECT_COLUMN_CANDIDATES = ['nombre_proyecto', 'nombre_obra', 'obra', 'obra_nombre'];
const projectColumnCache = new Map();

function getDb(db) {
  const resolved = db || global.db;
  if (!resolved) {
    throw new Error('Base de datos no inicializada');
  }
  return resolved;
}

function normalizeEmailArray(input) {
  const values = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeFormatosPorEmpresa(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : DEFAULT_FORMATOS_POR_EMPRESA;

  const normalized = {};
  for (const [empresaId, formatos] of Object.entries(source)) {
    normalized[String(empresaId)] = normalizeStringArray(formatos).filter((tabla) => FORM_TABLE_META[tabla]);
  }
  return normalized;
}

function sanitizeScope(scope = {}) {
  const obraId = scope.obra_id ? Number(scope.obra_id) : null;
  return {
    empresa_ids: Array.isArray(scope.empresa_ids)
      ? scope.empresa_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [],
    obra_id: Number.isInteger(obraId) && obraId > 0 ? obraId : null,
    obra_nombre: scope.obra_nombre ? String(scope.obra_nombre).trim() : null,
    nombres: normalizeStringArray(scope.nombres),
    segmentar_por_obra: scope.segmentar_por_obra === true || scope.segmentarPorObra === true,
  };
}

function roundPercentage(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function getIndicadorCentralDefaultConfig() {
  return {
    destinatarios: normalizeEmailArray(process.env.INDICADOR_CENTRAL_DESTINATARIOS || process.env.SMTP_FROM || ''),
    umbrales: {
      alerta_pct: 70,
      objetivo_pct: 90,
    },
    formatos_por_empresa: DEFAULT_FORMATOS_POR_EMPRESA,
    exclusiones: [],
    distribucion_habilitada: false,
    scope: {
      empresa_ids: [...DEFAULT_SCOPE_EMPRESA_IDS],
      obra_id: null,
      obra_nombre: null,
      segmentar_por_obra: false,
      nombres: []
    }
  };
}

export function normalizeIndicadorCentralConfig(config = {}) {
  const defaults = getIndicadorCentralDefaultConfig();
  return {
    destinatarios: normalizeEmailArray(config.destinatarios ?? defaults.destinatarios),
    umbrales: {
      alerta_pct: Number(config?.umbrales?.alerta_pct ?? defaults.umbrales.alerta_pct),
      objetivo_pct: Number(config?.umbrales?.objetivo_pct ?? defaults.umbrales.objetivo_pct),
    },
    formatos_por_empresa: normalizeFormatosPorEmpresa(config.formatos_por_empresa ?? defaults.formatos_por_empresa),
    exclusiones: normalizeStringArray(config.exclusiones ?? defaults.exclusiones),
    distribucion_habilitada: config.distribucion_habilitada === true,
    scope: sanitizeScope({
      ...(defaults.scope || {}),
      ...((config.scope && typeof config.scope === 'object' && !Array.isArray(config.scope)) ? config.scope : {})
    })
  };
}

function validateIndicadorCentralConfigShape(config) {
  const normalized = normalizeIndicadorCentralConfig(config);
  const totalFormatos = Object.values(normalized.formatos_por_empresa).reduce((acc, formatos) => acc + formatos.length, 0);
  if (totalFormatos === 0) {
    throw new Error('La configuración debe incluir al menos un formato esperado por empresa');
  }
  if (normalized.distribucion_habilitada && normalized.destinatarios.length === 0) {
    throw new Error('No podés habilitar la distribución sin destinatarios');
  }
  return normalized;
}

function validateRuntimeConfig(config, { canal = 'email', omitirEnvio = false } = {}) {
  if (!config) {
    throw new Error('No existe una configuración activa para el indicador central');
  }
  const normalized = normalizeIndicadorCentralConfig(config);
  const totalFormatos = Object.values(normalized.formatos_por_empresa).reduce((acc, formatos) => acc + formatos.length, 0);
  if (totalFormatos === 0) {
    throw new Error('La configuración activa no tiene formatos esperados');
  }
  if (canal === 'email' && !omitirEnvio) {
    if (!normalized.distribucion_habilitada) {
      throw new Error('La distribución automática está deshabilitada en la configuración activa');
    }
    if (normalized.destinatarios.length === 0) {
      throw new Error('La configuración activa no tiene destinatarios válidos');
    }
  }
  return normalized;
}

export function resolveFechaCorteDiario(now = DateTime.now().setZone(INDICADOR_CENTRAL_TIMEZONE)) {
  return now.startOf('day').minus({ days: 1 }).toISODate();
}

function resolveRangeForCutoff({ corteTipo = 'diario', fechaCorte }) {
  const normalized = formatDateOnly(fechaCorte);
  if (corteTipo === 'mensual') {
    if (!normalized) {
      throw new Error('Para corte mensual debés enviar fecha_corte');
    }
    const end = DateTime.fromISO(normalized, { zone: INDICADOR_CENTRAL_TIMEZONE }).endOf('month').toISODate();
    const start = DateTime.fromISO(normalized, { zone: INDICADOR_CENTRAL_TIMEZONE }).startOf('month').toISODate();
    return { fechaDesde: start, fechaHasta: end, fechaCorte: end };
  }

  const finalFechaCorte = normalized || resolveFechaCorteDiario();
  return {
    fechaDesde: finalFechaCorte,
    fechaHasta: finalFechaCorte,
    fechaCorte: finalFechaCorte
  };
}

async function getEmpresasMap(db, ids) {
  const uniqueIds = [...new Set((ids || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!uniqueIds.length) return {};
  const result = await db.query(`SELECT id, nombre FROM empresas WHERE id = ANY($1::int[])`, [uniqueIds]);
  return result.rows.reduce((acc, row) => {
    acc[row.id] = row.nombre || String(row.id);
    return acc;
  }, {});
}

async function detectProjectColumn(db, tabla) {
  if (projectColumnCache.has(tabla)) {
    return projectColumnCache.get(tabla);
  }

  for (const columnName of PROJECT_COLUMN_CANDIDATES) {
    const result = await db.query(
      `SELECT 1
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        LIMIT 1`,
      [tabla, columnName]
    );
    if (result.rows.length > 0) {
      projectColumnCache.set(tabla, columnName);
      return columnName;
    }
  }

  projectColumnCache.set(tabla, null);
  return null;
}

function buildDateRange(fechaDesde, fechaHasta) {
  const start = parseDateLocal(fechaDesde);
  const end = parseDateLocal(fechaHasta || fechaDesde || todayDateString());
  if (!start || !end) {
    throw new Error('Rango de fechas inválido para el indicador central');
  }

  const fechas = [];
  for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    fechas.push(formatDateOnly(new Date(current)));
  }
  return fechas;
}

async function resolveWorkerScope(db, scope) {
  const sanitizedScope = sanitizeScope(scope);
  const hasObraScope = Boolean(sanitizedScope.obra_id || sanitizedScope.obra_nombre);

  if (sanitizedScope.segmentar_por_obra || sanitizedScope.empresa_ids.length > 0 || !hasObraScope) {
    return sanitizedScope;
  }

  const values = [];
  const clauses = ['empresa_id IS NOT NULL'];

  if (sanitizedScope.obra_id) {
    values.push(sanitizedScope.obra_id);
    clauses.push(`id = $${values.length}`);
  }

  if (sanitizedScope.obra_nombre) {
    values.push(sanitizedScope.obra_nombre);
    clauses.push(`nombre_obra ILIKE $${values.length}`);
  }

  const result = await db.query(
    `SELECT DISTINCT empresa_id
       FROM obras
      WHERE ${clauses.join(' AND ')}`,
    values
  );
  const empresaIds = result.rows
    .map((row) => Number(row.empresa_id))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (empresaIds.length === 0) {
    return sanitizedScope;
  }

  return {
    ...sanitizedScope,
    empresa_ids: [...new Set(empresaIds)]
  };
}

function shouldApplyObraFilter(scope) {
  const hasObraScope = Boolean(scope.obra_id || scope.obra_nombre);
  if (!hasObraScope) return false;

  if (scope.segmentar_por_obra === true) {
    return true;
  }

  return scope.empresa_ids.length === 0;
}

async function getWorkersByScope(db, config) {
  const values = [];
  const clauses = ['COALESCE(t.activo, true) = true'];
  const scope = await resolveWorkerScope(db, config.scope);
  const applyObraFilter = shouldApplyObraFilter(scope);

  if (scope.empresa_ids.length > 0) {
    values.push(scope.empresa_ids);
    clauses.push(`t.empresa_id = ANY($${values.length}::int[])`);
  }
  if (scope.obra_id && applyObraFilter) {
    values.push(scope.obra_id);
    clauses.push(`t.obra_id = $${values.length}`);
  }
  if (scope.obra_nombre && applyObraFilter) {
    values.push(scope.obra_nombre);
    clauses.push(`o.nombre_obra ILIKE $${values.length}`);
  }
  if (scope.nombres.length > 0) {
    values.push(scope.nombres.map((nombre) => nombre.toLowerCase()));
    clauses.push(`LOWER(TRIM(t.nombre)) = ANY($${values.length}::text[])`);
  }
  if (config.exclusiones.length > 0) {
    values.push(config.exclusiones.map((nombre) => nombre.toLowerCase()));
    clauses.push(`LOWER(TRIM(t.nombre)) <> ALL($${values.length}::text[])`);
  }

  const result = await db.query(
    `SELECT t.id,
            t.nombre,
            t.empresa_id,
            t.obra_id,
            COALESCE(t.activo, true) AS activo,
            o.nombre_obra,
            o.constructora,
            o.departamento_id
       FROM trabajadores t
  LEFT JOIN obras o ON o.id = t.obra_id
      WHERE ${clauses.join(' AND ')}
   ORDER BY LOWER(TRIM(t.nombre)) ASC`,
    values
  );

  return result.rows;
}

function buildAggregatedMap(aggregatedRows) {
  const map = new Map();
  for (const row of aggregatedRows) {
    const fecha = formatDateOnly(row.fecha);
    const key = `${String(row.nombre).toLowerCase()}_${fecha}`;
    map.set(key, {
      total_registros: Number(row.total_registros || 0),
      nombre_proyecto: row.nombre_proyecto || '',
      formatos_llenos: Array.isArray(row.formatos_llenos) ? row.formatos_llenos.map(String) : []
    });
  }
  return map;
}

function buildWorkerSummaryKey(row) {
  return `${Number(row.empresa_id || 0)}::${String(row.nombre || '').trim().toLowerCase()}`;
}

function getFormatosOperativosEsperados(expectedFormatos = []) {
  return expectedFormatos.filter((tabla) => tabla !== FORMATO_INGRESO);
}

function summarizeIndicadorRowsByPersonaDia(rows) {
  const totalOperarios = rows.length;
  const operariosConActividad = rows.filter((row) => row.actividad_registrada).length;
  const operariosSinActividad = totalOperarios - operariosConActividad;
  const duplicated = rows.filter((row) => (row.anomalias || []).includes('duplicados_detectados')).length;
  const promedio = totalOperarios
    ? roundPercentage(rows.reduce((acc, row) => acc + Number(row.cumplimiento_pct || 0), 0) / totalOperarios)
    : 0;

  return {
    total_operarios: totalOperarios,
    operarios_con_actividad: operariosConActividad,
    operarios_sin_actividad: operariosSinActividad,
    promedio_cumplimiento_pct: promedio,
    duplicados_detectados: duplicated,
    granularidad_resumen: 'persona_dia',
    total_filas_detalle: totalOperarios,
    criterio_promedio_cumplimiento: 'promedio_simple_persona_dia'
  };
}

function summarizeIndicadorRowsMonthly(rows) {
  const byWorker = new Map();

  for (const row of rows) {
    const key = buildWorkerSummaryKey(row);
    const current = byWorker.get(key) || {
      tuvoActividad: false,
      diasActivosCumplimiento: [],
      tuvoDuplicados: false,
    };

    if (row.actividad_registrada) {
      current.tuvoActividad = true;
      current.diasActivosCumplimiento.push(Number(row.cumplimiento_pct || 0));
    }

    if ((row.anomalias || []).includes('duplicados_detectados')) {
      current.tuvoDuplicados = true;
    }

    byWorker.set(key, current);
  }

  const operarios = [...byWorker.values()];
  const totalOperarios = operarios.length;
  const operariosConActividad = operarios.filter((worker) => worker.tuvoActividad).length;
  const operariosSinActividad = totalOperarios - operariosConActividad;
  const duplicated = operarios.filter((worker) => worker.tuvoDuplicados).length;
  const promediosPorPersona = operarios
    .map((worker) => (
      worker.diasActivosCumplimiento.length
        ? roundPercentage(
          worker.diasActivosCumplimiento.reduce((acc, value) => acc + value, 0) / worker.diasActivosCumplimiento.length
        )
        : null
    ))
    .filter((value) => value !== null);
  const promedio = promediosPorPersona.length
    ? roundPercentage(promediosPorPersona.reduce((acc, value) => acc + value, 0) / promediosPorPersona.length)
    : 0;

  return {
    total_operarios: totalOperarios,
    operarios_con_actividad: operariosConActividad,
    operarios_sin_actividad: operariosSinActividad,
    promedio_cumplimiento_pct: promedio,
    duplicados_detectados: duplicated,
    granularidad_resumen: 'persona_unica_mensual',
    total_filas_detalle: rows.length,
    criterio_promedio_cumplimiento: 'promedio_de_promedios_por_persona_solo_dias_con_actividad',
    metricas_persona_dia: summarizeIndicadorRowsByPersonaDia(rows)
  };
}

function summarizeIndicadorRows(rows, { corteTipo = 'diario' } = {}) {
  if (corteTipo === 'mensual') {
    return summarizeIndicadorRowsMonthly(rows);
  }

  return summarizeIndicadorRowsByPersonaDia(rows);
}

function buildAusenciasNoIngresoRows(rows) {
  return rows
    .filter((row) => !row.actividad_registrada)
    .map((row) => ({
      fecha: row.fecha,
      empresa_id: Number(row.empresa_id || 0),
      empresa: row.empresa || '',
      nombre: row.nombre,
      nombre_proyecto: row.nombre_proyecto || row.obra_nombre || '',
      obra_nombre: row.obra_nombre || '',
      total_registros: Number(row.total_registros || 0),
      formatos_llenos: Array.isArray(row.formatos_llenos) ? [...row.formatos_llenos] : [],
      formatos_operativos_llenos: Array.isArray(row.formatos_operativos_llenos) ? [...row.formatos_operativos_llenos] : [],
      formatos_operativos_faltantes: Array.isArray(row.formatos_operativos_faltantes) ? [...row.formatos_operativos_faltantes] : [],
      formatos_faltantes: Array.isArray(row.formatos_faltantes) ? [...row.formatos_faltantes] : [],
      anomalias: Array.isArray(row.anomalias) ? [...row.anomalias] : []
    }))
    .sort((a, b) => (
      String(a.fecha).localeCompare(String(b.fecha))
      || String(a.empresa).localeCompare(String(b.empresa), 'es')
      || String(a.nombre).localeCompare(String(b.nombre), 'es')
    ));
}

function buildDesempenoPorPersonaRows(rows) {
  const byWorker = new Map();

  for (const row of rows) {
    const key = buildWorkerSummaryKey(row);
    const current = byWorker.get(key) || {
      empresa_id: Number(row.empresa_id || 0),
      empresa: row.empresa || '',
      nombre: row.nombre,
      dias_evaluados: 0,
      dias_con_ingreso: 0,
      dias_sin_ingreso: 0,
      dias_con_duplicados: 0,
      dias_con_registros: 0,
      formatos_operativos_esperados_total: 0,
      formatos_operativos_llenos_total: 0,
      total_registros_periodo: 0,
      cumplimiento_pct_persona_dia_sum: 0,
      proyectos_obras: new Set(),
      anomalias: new Set()
    };

    current.dias_evaluados += 1;
    current.total_registros_periodo += Number(row.total_registros || 0);
    current.formatos_operativos_esperados_total += Number(row.esperado_operativo_por_dia || 0);
    current.formatos_operativos_llenos_total += Array.isArray(row.formatos_operativos_llenos) ? row.formatos_operativos_llenos.length : 0;
    current.cumplimiento_pct_persona_dia_sum += Number(row.cumplimiento_pct || 0);

    if (row.actividad_registrada) {
      current.dias_con_ingreso += 1;
    } else {
      current.dias_sin_ingreso += 1;
    }

    if (Number(row.total_registros || 0) > 0) {
      current.dias_con_registros += 1;
    }

    if ((row.anomalias || []).includes('duplicados_detectados')) {
      current.dias_con_duplicados += 1;
    }

    for (const proyecto of [row.nombre_proyecto, row.obra_nombre]) {
      if (proyecto) {
        current.proyectos_obras.add(String(proyecto).trim());
      }
    }

    for (const anomalia of (row.anomalias || [])) {
      current.anomalias.add(anomalia);
    }

    byWorker.set(key, current);
  }

  return [...byWorker.values()]
    .map((row) => {
      const ingresoPct = row.dias_evaluados
        ? roundPercentage((row.dias_con_ingreso / row.dias_evaluados) * 100)
        : 0;
      const cumplimientoPctPeriodo = row.formatos_operativos_esperados_total
        ? roundPercentage(Math.min(100, (row.formatos_operativos_llenos_total / row.formatos_operativos_esperados_total) * 100))
        : 0;

      return {
        empresa_id: row.empresa_id,
        empresa: row.empresa,
        nombre: row.nombre,
        dias_evaluados: row.dias_evaluados,
        dias_con_ingreso: row.dias_con_ingreso,
        dias_sin_ingreso: row.dias_sin_ingreso,
        ingreso_pct_periodo: ingresoPct,
        formatos_operativos_esperados_total: row.formatos_operativos_esperados_total,
        formatos_operativos_llenos_total: row.formatos_operativos_llenos_total,
        cumplimiento_pct_periodo: cumplimientoPctPeriodo,
        dias_con_duplicados: row.dias_con_duplicados,
        dias_con_registros: row.dias_con_registros,
        total_registros_periodo: row.total_registros_periodo,
        promedio_cumplimiento_pct_persona_dia: row.dias_evaluados
          ? roundPercentage(row.cumplimiento_pct_persona_dia_sum / row.dias_evaluados)
          : 0,
        proyectos_obras: [...row.proyectos_obras],
        anomalias: [...row.anomalias]
      };
    })
    .sort((a, b) => (
      String(a.empresa).localeCompare(String(b.empresa), 'es')
      || String(a.nombre).localeCompare(String(b.nombre), 'es')
    ));
}

export function buildIndicadorCentralWorkbookDatasets(rows, { corteTipo = 'diario' } = {}) {
  return {
    resumen: summarizeIndicadorRows(rows, { corteTipo }),
    detalle: [...rows],
    ausencias_no_ingreso: buildAusenciasNoIngresoRows(rows),
    desempeno_por_persona: buildDesempenoPorPersonaRows(rows)
  };
}

async function persistSnapshotRows(db, { rows, batchId, executionId = null, corteTipo, fechaCorte }) {
  for (const row of rows) {
    await db.query(
      `INSERT INTO indicador_central_dataset_snapshot (
        batch_id,
        execution_id,
        corte_tipo,
        corte_fecha,
        fecha_registro,
        empresa_id,
        empresa,
        nombre_operador,
        nombre_proyecto,
        obra_id,
        obra_nombre,
        actividad_registrada,
        cumplimiento_pct,
        total_registros,
        formatos_llenos,
        formatos_faltantes,
        anomalias,
        raw
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17::jsonb,$18::jsonb
      )`,
      [
        batchId,
        executionId,
        corteTipo,
        fechaCorte,
        row.fecha,
        row.empresa_id,
        row.empresa,
        row.nombre,
        row.nombre_proyecto,
        row.obra_id,
        row.obra_nombre,
        row.actividad_registrada,
        row.cumplimiento_pct,
        row.total_registros,
        JSON.stringify(row.formatos_llenos || []),
        JSON.stringify(row.formatos_faltantes || []),
        JSON.stringify(row.anomalias || []),
        JSON.stringify(row)
      ]
    );
  }
}

export async function getActiveIndicadorCentralConfig(db) {
  const resolvedDb = getDb(db);
  const result = await resolvedDb.query(
    `SELECT *
       FROM indicador_central_config_versions
      WHERE is_active = true
   ORDER BY version DESC, id DESC
      LIMIT 1`
  );
  if (result.rows.length === 0) return null;
  return {
    ...result.rows[0],
    ...normalizeIndicadorCentralConfig(result.rows[0])
  };
}

export async function saveIndicadorCentralConfig(config, { db, updatedBy = 'system' } = {}) {
  const resolvedDb = getDb(db);
  const normalized = validateIndicadorCentralConfigShape(config);
  const versionResult = await resolvedDb.query(`SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM indicador_central_config_versions`);
  const nextVersion = Number(versionResult.rows[0]?.next_version || 1);

  await resolvedDb.query(`UPDATE indicador_central_config_versions SET is_active = false WHERE is_active = true`);
  const result = await resolvedDb.query(
    `INSERT INTO indicador_central_config_versions (
      version,
      is_active,
      destinatarios,
      umbrales,
      formatos_por_empresa,
      exclusiones,
      distribucion_habilitada,
      scope,
      updated_by
    ) VALUES ($1, true, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)
    RETURNING *`,
    [
      nextVersion,
      JSON.stringify(normalized.destinatarios),
      JSON.stringify(normalized.umbrales),
      JSON.stringify(normalized.formatos_por_empresa),
      JSON.stringify(normalized.exclusiones),
      normalized.distribucion_habilitada,
      JSON.stringify(normalized.scope),
      updatedBy
    ]
  );

  return {
    ...result.rows[0],
    ...normalizeIndicadorCentralConfig(result.rows[0])
  };
}

export async function buildIndicadorCentralDataset({
  fechaDesde,
  fechaHasta,
  corteTipo = 'diario',
  configuracion,
  persistirSnapshot = false,
  executionId = null,
  fechaCorte,
  db
}) {
  const resolvedDb = getDb(db);
  const runtimeConfig = normalizeIndicadorCentralConfig(configuracion || (await getActiveIndicadorCentralConfig(resolvedDb)) || getIndicadorCentralDefaultConfig());
  const workers = await getWorkersByScope(resolvedDb, runtimeConfig);
  const fechas = buildDateRange(fechaDesde, fechaHasta);
  const empresasMap = await getEmpresasMap(resolvedDb, workers.map((worker) => worker.empresa_id));
  const rows = [];

  for (const empresaId of [...new Set(workers.map((worker) => Number(worker.empresa_id)).filter(Boolean))]) {
    const expectedFormatos = runtimeConfig.formatos_por_empresa[String(empresaId)] || [];
    const expectedOperationalFormatos = getFormatosOperativosEsperados(expectedFormatos);
    const tablasConfiguradas = expectedFormatos.map((tabla) => FORM_TABLE_META[tabla]).filter(Boolean);
    const workersEmpresa = workers.filter((worker) => Number(worker.empresa_id) === Number(empresaId));
    const lowerNames = workersEmpresa.map((worker) => String(worker.nombre).trim().toLowerCase());

    let aggregatedRows = [];
    if (tablasConfiguradas.length > 0 && lowerNames.length > 0) {
      const unionParts = [];
      let pr = 0;
      for (const tablaDef of tablasConfiguradas) {
        const projectColumn = await detectProjectColumn(resolvedDb, tablaDef.tabla);
        if (projectColumn) {
          unionParts.push(`SELECT LOWER(TRIM(${tablaDef.campoNombre})) AS nombre, CAST(${tablaDef.campoFecha} AS date) AS fecha, ${projectColumn} AS nombre_proyecto, '${tablaDef.tabla}' AS formato, ${pr++} AS pr FROM ${tablaDef.tabla} WHERE CAST(${tablaDef.campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${tablaDef.campoNombre})) = ANY($3::text[])`);
        } else {
          unionParts.push(`SELECT LOWER(TRIM(${tablaDef.campoNombre})) AS nombre, CAST(${tablaDef.campoFecha} AS date) AS fecha, NULL::text AS nombre_proyecto, '${tablaDef.tabla}' AS formato, ${pr++} AS pr FROM ${tablaDef.tabla} WHERE CAST(${tablaDef.campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${tablaDef.campoNombre})) = ANY($3::text[])`);
        }
      }

      if (unionParts.length > 0) {
        const finalQuery = `SELECT nombre, fecha, COALESCE((ARRAY_AGG(nombre_proyecto ORDER BY pr) FILTER (WHERE nombre_proyecto IS NOT NULL))[1], '') AS nombre_proyecto, ARRAY_AGG(DISTINCT formato) AS formatos_llenos, COUNT(*) AS total_registros FROM (${unionParts.join(' UNION ALL ')}) t GROUP BY nombre, fecha ORDER BY nombre, fecha`;
        const result = await resolvedDb.query(finalQuery, [fechaDesde, fechaHasta, lowerNames]);
        aggregatedRows = result.rows || [];
      }
    }

    const aggregatedMap = buildAggregatedMap(aggregatedRows);

    for (const worker of workersEmpresa) {
      for (const fecha of fechas) {
        const key = `${String(worker.nombre).trim().toLowerCase()}_${fecha}`;
        const aggregated = aggregatedMap.get(key) || { total_registros: 0, nombre_proyecto: worker.nombre_obra || '', formatos_llenos: [] };
        const formatosLlenos = [...new Set((aggregated.formatos_llenos || []).map(String))];
        const formatosFaltantes = expectedFormatos.filter((tabla) => !formatosLlenos.includes(tabla));
        const formatosOperativosLlenos = expectedOperationalFormatos.filter((tabla) => formatosLlenos.includes(tabla));
        const formatosOperativosFaltantes = expectedOperationalFormatos.filter((tabla) => !formatosLlenos.includes(tabla));
        const actividadRegistrada = formatosLlenos.includes(FORMATO_INGRESO);
        const anomalias = [];
        if ((aggregated.total_registros || 0) > formatosLlenos.length) anomalias.push('duplicados_detectados');
        if (!expectedFormatos.length) anomalias.push('sin_formatos_configurados');
        if (expectedFormatos.length > 0 && expectedOperationalFormatos.length === 0) anomalias.push('sin_formatos_operativos_configurados');
        if (!worker.obra_id) anomalias.push('sin_obra_asignada');
        if (!aggregated.nombre_proyecto && formatosLlenos.length > 0) anomalias.push('sin_nombre_proyecto');

        rows.push({
          fecha,
          corte_tipo: corteTipo,
          fecha_corte: fechaCorte || fechaHasta,
          empresa_id: Number(worker.empresa_id || 0),
          empresa: empresasMap[worker.empresa_id] || String(worker.empresa_id || ''),
          obra_id: worker.obra_id || null,
          obra_nombre: worker.nombre_obra || '',
          nombre: worker.nombre,
          nombre_proyecto: aggregated.nombre_proyecto || worker.nombre_obra || '',
          total_registros: Number(aggregated.total_registros || 0),
          formatos_llenos: formatosLlenos,
          formatos_faltantes: formatosFaltantes,
          formatos_operativos_llenos: formatosOperativosLlenos,
          formatos_operativos_faltantes: formatosOperativosFaltantes,
          actividad_registrada: actividadRegistrada,
          actividad_validada_por: FORMATO_INGRESO,
          cumplimiento_validado_sobre: 'formatos_operativos',
          cumplimiento_pct: expectedOperationalFormatos.length
            ? roundPercentage(Math.min(100, (formatosOperativosLlenos.length / expectedOperationalFormatos.length) * 100))
            : 0,
          anomalias,
          esperado_por_dia: expectedFormatos.length,
          esperado_operativo_por_dia: expectedOperationalFormatos.length,
        });
      }
    }
  }

  const workbookDatasets = buildIndicadorCentralWorkbookDatasets(rows, { corteTipo });
  const resumen = workbookDatasets.resumen;
  let snapshotBatchId = null;
  if (persistirSnapshot) {
    snapshotBatchId = `indicador-central-${Date.now()}`;
    await persistSnapshotRows(resolvedDb, {
      rows,
      batchId: snapshotBatchId,
      executionId,
      corteTipo,
      fechaCorte: fechaCorte || fechaHasta
    });
  }

  return {
    rows,
    resumen,
    workbook_datasets: workbookDatasets,
    configuracion: runtimeConfig,
    snapshot_batch_id: snapshotBatchId,
    fecha_desde: fechaDesde,
    fecha_hasta: fechaHasta
  };
}

function buildEmailHtml({ fechaCorte, corteTipo, resumen }) {
  const labels = corteTipo === 'mensual'
    ? {
      total: 'Operarios únicos evaluados',
      conActividad: 'Operarios únicos con ingreso',
      sinActividad: 'Operarios únicos sin ingreso',
      duplicados: 'Operarios únicos con duplicados',
    }
    : {
      total: 'Operarios evaluados',
      conActividad: 'Con ingreso',
      sinActividad: 'Sin ingreso',
      duplicados: 'Duplicados detectados',
    };
  const detallePersonaDia = corteTipo === 'mensual' && resumen.metricas_persona_dia
    ? `
      <li><strong>Detalle auditado (persona-día):</strong> ${resumen.metricas_persona_dia.total_operarios ?? 0}</li>
      <li><strong>Días con ingreso:</strong> ${resumen.metricas_persona_dia.operarios_con_actividad ?? 0}</li>
      <li><strong>Días sin ingreso:</strong> ${resumen.metricas_persona_dia.operarios_sin_actividad ?? 0}</li>
      <li><strong>Días con duplicados:</strong> ${resumen.metricas_persona_dia.duplicados_detectados ?? 0}</li>
    `
    : '';

  return `
    <h2>Indicador de adaptación app La Central</h2>
    <p><strong>Corte:</strong> ${fechaCorte}</p>
    <p><strong>Tipo:</strong> ${corteTipo}</p>
    <p><strong>Granularidad resumen:</strong> ${resumen.granularidad_resumen ?? 'persona_dia'}</p>
    <ul>
      <li><strong>Ingreso validado por:</strong> ${FORMATO_INGRESO}</li>
      <li><strong>Cumplimiento validado sobre:</strong> formatos operativos (excluye ${FORMATO_INGRESO})</li>
      <li><strong>${labels.total}:</strong> ${resumen.total_operarios ?? 0}</li>
      <li><strong>${labels.conActividad}:</strong> ${resumen.operarios_con_actividad ?? 0}</li>
      <li><strong>${labels.sinActividad}:</strong> ${resumen.operarios_sin_actividad ?? 0}</li>
      <li><strong>Promedio cumplimiento:</strong> ${resumen.promedio_cumplimiento_pct ?? 0}%</li>
      <li><strong>${labels.duplicados}:</strong> ${resumen.duplicados_detectados ?? 0}</li>
      ${detallePersonaDia}
    </ul>
    <p>Adjuntamos el detalle en XLSX para auditoría y seguimiento.</p>
  `;
}

async function sendIndicadorCentralEmail({ destinatarios, workbookBuffer, fechaCorte, corteTipo, resumen }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT, 10) : 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const attachmentName = `indicador_central_${corteTipo}_${fechaCorte}.xlsx`;
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: destinatarios.join(', '),
    subject: `Indicador de adaptación app La Central | corte ${fechaCorte}`,
    text: `Indicador de adaptación de La Central para el corte ${fechaCorte}. Operarios evaluados: ${resumen.total_operarios ?? 0}.`,
    html: buildEmailHtml({ fechaCorte, corteTipo, resumen }),
    attachments: [
      {
        filename: attachmentName,
        content: workbookBuffer
      }
    ]
  });
  return attachmentName;
}

export async function runIndicadorCentralCutoff({
  fechaCorte,
  corteTipo = 'diario',
  origen = 'manual',
  canal = 'email',
  omitirEnvio = false,
  db
}) {
  const resolvedDb = getDb(db);
  const activeConfig = await getActiveIndicadorCentralConfig(resolvedDb);
  const config = validateRuntimeConfig(activeConfig, { canal, omitirEnvio });
  const range = resolveRangeForCutoff({ corteTipo, fechaCorte });

  if (!omitirEnvio) {
    const existingSuccess = await resolvedDb.query(
      `SELECT *
         FROM indicador_central_ejecuciones
        WHERE corte_tipo = $1
          AND corte_fecha = $2
          AND canal = $3
          AND estado = 'success'
        LIMIT 1`,
      [corteTipo, range.fechaCorte, canal]
    );
    if (existingSuccess.rows.length > 0) {
      return {
        already_processed: true,
        ejecucion: existingSuccess.rows[0]
      };
    }
  }

  const insertExecution = await resolvedDb.query(
    `INSERT INTO indicador_central_ejecuciones (
      corte_tipo,
      corte_fecha,
      canal,
      estado,
      origen,
      config_version_id,
      destinatarios,
      metadata
    ) VALUES ($1, $2, $3, 'running', $4, $5, $6::jsonb, $7::jsonb)
    RETURNING *`,
    [
      corteTipo,
      range.fechaCorte,
      canal,
      origen,
      activeConfig?.id || null,
      JSON.stringify(config.destinatarios),
      JSON.stringify({ omitir_envio: omitirEnvio })
    ]
  );
  const execution = insertExecution.rows[0];

  try {
    const dataset = await buildIndicadorCentralDataset({
      fechaDesde: range.fechaDesde,
      fechaHasta: range.fechaHasta,
      corteTipo,
      configuracion: config,
      persistirSnapshot: true,
      executionId: execution.id,
      fechaCorte: range.fechaCorte,
      db: resolvedDb
    });

    const workbookBuffer = await generateIndicadorCentralWorkbookBuffer({
      rows: dataset.rows,
      resumen: dataset.resumen,
      corteTipo,
      fechaCorte: range.fechaCorte,
      fechaDesde: dataset.fecha_desde,
      fechaHasta: dataset.fecha_hasta,
      configuracion: config,
      workbookDatasets: dataset.workbook_datasets
    });

    let attachmentName = null;
    if (!omitirEnvio) {
      attachmentName = await sendIndicadorCentralEmail({
        destinatarios: config.destinatarios,
        workbookBuffer,
        fechaCorte: range.fechaCorte,
        corteTipo,
        resumen: dataset.resumen
      });
    }

    const updateResult = await resolvedDb.query(
      `UPDATE indicador_central_ejecuciones
          SET estado = 'success',
              finished_at = NOW(),
              snapshot_batch_id = $1,
              resumen = $2::jsonb,
              metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
        WHERE id = $4
    RETURNING *`,
      [
        dataset.snapshot_batch_id,
        JSON.stringify(dataset.resumen),
        JSON.stringify({ attachment_name: attachmentName, omitir_envio: omitirEnvio }),
        execution.id
      ]
    );

    return {
      already_processed: false,
      ejecucion: updateResult.rows[0],
      resumen: dataset.resumen,
      snapshot_batch_id: dataset.snapshot_batch_id,
      rows: dataset.rows
    };
  } catch (error) {
    await resolvedDb.query(
      `UPDATE indicador_central_ejecuciones
          SET estado = 'failed',
              finished_at = NOW(),
              error_message = $1
        WHERE id = $2`,
      [error.message, execution.id]
    );
    throw error;
  }
}

