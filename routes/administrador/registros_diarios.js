import { Router } from "express";
import {
  buildIndicadorCentralDataset,
  buildIndicadorCentralWorkbookDatasets,
  getActiveIndicadorCentralConfig,
  getIndicadorCentralDefaultConfig,
  normalizeIndicadorCentralConfig,
  validateRuntimeConfig,
} from '../../helpers/indicador_central.js';
import { generateRegistrosDiariosWorkbookBuffer } from '../../helpers/indicador_central_excel.js';
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';


const router = Router();

router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de registros diarios");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

function buildFechaPagination(startDate, endDate, limit = 200, offset = 0) {
  const fechas = [];
  const inicio = parseDateLocal(startDate);
  const fin = parseDateLocal(endDate);
  for (let current = new Date(inicio); current <= fin; current.setDate(current.getDate() + 1)) {
    fechas.push(formatDateOnly(new Date(current)));
  }
  return fechas.slice(offset, offset + Number(limit));
}

function buildRuntimeConfig(nombre) {
  const defaults = getIndicadorCentralDefaultConfig();  
  return normalizeIndicadorCentralConfig({
    ...defaults,
    distribucion_habilitada: true,
    scope: {
      empresa_ids: [],
      obra_id: null,
      obra_nombre: null,
      nombres: nombre ? [nombre] : []
    }
  });
}

function serializeRows(rows) {
  return rows.map((row) => ({
    fecha: row.fecha,
    nombre: row.nombre,
    empresa: row.empresa,
    nombre_proyecto: row.nombre_proyecto || '',
    total_registros: row.total_registros,
    formatos_llenos: row.formatos_llenos || [],
    formatos_faltantes: row.formatos_faltantes || [],
    actividad_registrada: row.actividad_registrada,
    cumplimiento_pct: row.cumplimiento_pct,
    anomalias: row.anomalias || []
  }));
}

/**
 * POST /administrador/registros_diarios/buscar
 * Retorna el resumen de registros diarios usando el helper compartido del indicador central.
 */
router.post('/buscar', async (req, res) => {
  try {
    const { nombre, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio) || todayDateString();
    const endDate = formatDateOnly(fecha_fin) || todayDateString();
    const fechasPaginadas = buildFechaPagination(startDate, endDate, limit, offset);

    const dataset = await buildIndicadorCentralDataset({
      fechaDesde: startDate,
      fechaHasta: endDate,
      corteTipo: 'diario',
      configuracion: buildRuntimeConfig(nombre),
      persistirSnapshot: false,
      db: global.db
    });

    const rows = serializeRows(dataset.rows).filter((row) => fechasPaginadas.includes(row.fecha));
    return res.json({ success: true, count: rows.length, rows });
  } catch (error) {
    console.error("Error en /registros_diarios/buscar:", error);
    return res.status(500).json({
      error: "Error al buscar registros diarios",
      detalle: error.message
    });
  }
});

/**
 * POST /administrador/registros_diarios/descargar
 * Descarga el resumen de registros diarios como XLSX usando el helper compartido del indicador.
 */
router.post('/descargar', async (req, res) => {
  try {
    const { nombre, fecha_inicio, fecha_fin, limit = 10000, corte_tipo} = req.body || {};
    
    const startDate = formatDateOnly(fecha_inicio) || todayDateString();
    const endDate = formatDateOnly(fecha_fin) || todayDateString();
    const fechasPaginadas = buildFechaPagination(startDate, endDate, Math.min(Number(limit), 10000), 0);
    const avtiveConfig = await getActiveIndicadorCentralConfig(global.db);
    const config = validateRuntimeConfig(avtiveConfig,{canal:'manual', omitirEnvio:true})

    const dataset = await buildIndicadorCentralDataset({
      fechaDesde: startDate,
      fechaHasta: endDate,
      corteTipo: corte_tipo ?? 'diario',
      configuracion: config,
      persistirSnapshot: false,
      db: global.db
    });

    const rows = dataset.rows.filter((row) => fechasPaginadas.includes(row.fecha));
    const workbookDatasets = buildIndicadorCentralWorkbookDatasets(rows, { corteTipo: corte_tipo });
    const buffer = await generateRegistrosDiariosWorkbookBuffer({
      rows,
      resumen: workbookDatasets.resumen,
      corteTipo: corte_tipo,
      fechaCorte: endDate,
      fechaDesde: startDate,
      fechaHasta: endDate,
      configuracion: dataset.configuracion,
      workbookDatasets
    });

    const filenameUser = (typeof nombre === 'string' && nombre.trim()) ? nombre.replace(/\s+/g, '_') : 'todos';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registros_diarios_${filenameUser}_${startDate}_${endDate}.xlsx"`);
    return res.send(buffer);
  } catch (error) {
    console.error("Error en /registros_diarios/descargar:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Error al generar archivo Excel",
        detalle: error.message
      });
    }
  }
});

export default router;
