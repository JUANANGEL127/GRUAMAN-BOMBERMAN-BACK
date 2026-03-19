import { Router } from "express";
import ExcelJS from 'exceljs';
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';
const router = Router();

router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de registros diarios");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

/**
 * Mapeo de tablas de formularios a rastrear por empresa.
 * Cada entrada define qué tabla consultar, junto con las columnas de nombre del operador y fecha.
 * @type {Record<number, Array<{ tabla: string, campoNombre: string, campoFecha: string }>>}
 */
const REGISTROS_POR_EMPRESA = {
  1: [
    { tabla: 'chequeo_alturas', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'chequeo_elevador', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'inspeccion_epcc', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'inspeccion_izaje', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'permiso_trabajo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'chequeo_torregruas', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'horas_jornada', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' }
  ],
  2: [
    { tabla: 'inspeccion_epcc', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'permiso_trabajo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'horas_jornada', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'checklist', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'inventario_obra', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'planilla_bombeo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'chequeo_alturas', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' }
  ],
  5: [
    { tabla: 'inspeccion_epcc', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'permiso_trabajo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'horas_jornada', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'checklist', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'inventario_obra', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'planilla_bombeo', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' },
    { tabla: 'chequeo_alturas', campoNombre: 'nombre_operador', campoFecha: 'fecha_servicio' }
  ]
};

/**
 * Obtiene un mapa { [empresa_id]: nombre } para un conjunto de IDs de empresa.
 * Retorna un objeto vacío si la consulta falla.
 * @param {import('pg').Pool} db
 * @param {number[]} ids
 * @returns {Promise<Record<number, string>>}
 */
async function getEmpresasMap(db, ids) {
  const out = {};
  try {
    const idsArr = [...new Set((ids || []).filter(Boolean))];
    if (!idsArr.length) return out;
    const q = `SELECT id, nombre FROM empresas WHERE id = ANY($1::int[])`;
    const r = await db.query(q, [idsArr]);
    for (const row of r.rows || []) out[row.id] = row.nombre || String(row.id);
  } catch (err) {
    console.error('Error getEmpresasMap:', err);
  }
  return out;
}

/**
 * POST /administrador/registros_diarios/buscar
 * Retorna un resumen de cumplimiento por trabajador y por fecha, indicando qué tablas de formularios
 * se han llenado y cuáles siguen pendientes, dentro del rango de fechas solicitado.
 * Los trabajadores se resuelven desde la tabla `trabajadores`. Los resultados se paginan por fecha.
 * @body {{ nombre?: string, fecha_inicio?: string, fecha_fin?: string, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array<{ fecha: string, nombre: string, empresa: string, nombre_proyecto: string, total_registros: number, formatos_llenos: string[], formatos_faltantes: string[] }> }}
 * @throws {404} Si el trabajador especificado no se encuentra.
 */
router.post('/buscar', async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }

  try {
    const { nombre, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    let trabajadoresList = [];
    if (nombre) {
      const trabajadorResult = await db.query(
        `SELECT nombre, empresa_id FROM trabajadores WHERE nombre ILIKE $1 LIMIT 1`,
        [nombre]
      );
      if (trabajadorResult.rows.length === 0) {
        return res.status(404).json({
          error: "Trabajador no encontrado",
          nombre_buscado: nombre
        });
      }
      trabajadoresList = trabajadorResult.rows;
    } else {
      const allRes = await db.query(`SELECT nombre, empresa_id FROM trabajadores`);
      trabajadoresList = allRes.rows || [];
    }

    if (!trabajadoresList.length) {
      return res.status(404).json({ error: 'No se encontraron trabajadores para procesar' });
    }

    const empresasMap = await getEmpresasMap(db, trabajadoresList.map(t => t.empresa_id));

    const fechas = [];
    const inicio = parseDateLocal(startDate);
    const fin = parseDateLocal(endDate);

    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      fechas.push(formatDateOnly(new Date(d)));
    }

    const fechasPaginadas = fechas.slice(offset, offset + parseInt(limit));
    const resultadosPorFecha = [];

    // Caché: { [tabla]: string|null } — memoriza la columna de nombre de proyecto detectada por tabla.
    const nombreProyectoCol = {};

    for (const empresa_id_val of [...new Set(trabajadoresList.map(t => t.empresa_id))]) {
      const trabajadoresDeEmpresa = trabajadoresList.filter(t => t.empresa_id === empresa_id_val).map(t => t.nombre);
      const registrosAsignados = REGISTROS_POR_EMPRESA[empresa_id_val] || [];
      if (!registrosAsignados.length) continue;

      const lowerNames = trabajadoresDeEmpresa.map(n => String(n).trim().toLowerCase());

      let pr = 0;
      const unionParts = [];
      for (const registro of registrosAsignados) {
        const { tabla, campoNombre, campoFecha } = registro;
        if (!(tabla in nombreProyectoCol)) {
          try {
            const candidates = ['nombre_proyecto','nombre_obra','obra','obra_nombre'];
            let found = null;
            for (const c of candidates) {
              try {
                const colQ = `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`;
                const colR = await db.query(colQ, [tabla, c]);
                if (colR.rows && colR.rows.length > 0) { found = c; break; }
              } catch (e) {
                // ignorar error al sondear columna
              }
            }
            nombreProyectoCol[tabla] = found;
          } catch (err) {
            nombreProyectoCol[tabla] = null;
          }
        }

        const colName = nombreProyectoCol[tabla];
        if (colName) {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, ${colName} AS nombre_proyecto, '${tabla}' AS formato, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[])`);
        } else {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, NULL::text AS nombre_proyecto, '${tabla}' AS formato, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[])`);
        }
      }

      if (!unionParts.length) continue;

      const finalQuery = `SELECT nombre, fecha, COALESCE((ARRAY_AGG(nombre_proyecto ORDER BY pr) FILTER (WHERE nombre_proyecto IS NOT NULL))[1],'') AS nombre_proyecto, ARRAY_AGG(DISTINCT formato) AS formatos_llenos, COUNT(*) AS total_registros FROM ( ${unionParts.join(' UNION ALL ')} ) t GROUP BY nombre, fecha ORDER BY nombre, fecha`;

      let aggregated = [];
      try {
        console.log(`[REGISTROS_DIARIOS] Ejecutando consulta agregada empresa=${empresa_id_val}`);
        const agR = await db.query(finalQuery, [startDate, endDate, lowerNames]);
        aggregated = agR.rows || [];
      } catch (err) {
        console.error('Error en consulta agregada por empresa', empresa_id_val, err);
        aggregated = [];
      }

      const map = new Map();
      for (const r of aggregated) {
        const fechaKey = formatDateOnly(r.fecha);
        const key = `${String(r.nombre).toLowerCase()}_${fechaKey}`;
        map.set(key, { total_registros: parseInt(r.total_registros || 0), nombre_proyecto: r.nombre_proyecto || '', formatos_llenos: r.formatos_llenos || [] });
      }

      const expectedFormatos = registrosAsignados.map(r => r.tabla);
      for (const nombreTrabajador of trabajadoresDeEmpresa) {
        for (const fecha of fechasPaginadas) {
          const key = `${String(nombreTrabajador).trim().toLowerCase()}_${fecha}`;
          const entry = map.get(key) || { total_registros: 0, nombre_proyecto: '', formatos_llenos: [] };
          const filled = (entry.formatos_llenos || []).map(String);
          const faltantes = expectedFormatos.filter(e => !filled.includes(e));
          resultadosPorFecha.push({ fecha, nombre: nombreTrabajador, empresa: empresasMap[empresa_id_val] || empresa_id_val, nombre_proyecto: entry.nombre_proyecto, total_registros: entry.total_registros, formatos_llenos: filled, formatos_faltantes: faltantes });
        }
      }
    }

    res.json({ success: true, count: resultadosPorFecha.length, rows: resultadosPorFecha });

  } catch (error) {
    console.error("Error en /registros_diarios/buscar:", error);
    res.status(500).json({
      error: "Error al buscar registros diarios",
      detalle: error.message
    });
  }
});

/**
 * POST /administrador/registros_diarios/descargar
 * Envía el mismo resumen de cumplimiento que `/buscar` como un archivo XLSX formateado.
 * Soporta hasta 10,000 fechas. Usa el escritor de streaming de ExcelJS para evitar buffering.
 * @body {{ nombre?: string, fecha_inicio?: string, fecha_fin?: string, limit?: number }}
 * @returns {Buffer} Adjunto del libro de Excel (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
 * @throws {404} Si el trabajador especificado no se encuentra.
 */
router.post('/descargar', async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }

  try {
    const { nombre, fecha_inicio, fecha_fin, limit = 10000 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    let trabajadoresList = [];
    if (nombre) {
      const trabajadorResult = await db.query(
        `SELECT nombre, empresa_id FROM trabajadores WHERE nombre ILIKE $1 LIMIT 1`,
        [nombre]
      );
      if (trabajadorResult.rows.length === 0) {
        return res.status(404).json({
          error: "Trabajador no encontrado",
          nombre_buscado: nombre
        });
      }
      trabajadoresList = trabajadorResult.rows;
    } else {
      const allRes = await db.query(`SELECT nombre, empresa_id FROM trabajadores`);
      trabajadoresList = allRes.rows || [];
    }

    if (!trabajadoresList.length) {
      return res.status(404).json({ error: 'No se encontraron trabajadores para procesar' });
    }

    const empresasMap = await getEmpresasMap(db, trabajadoresList.map(t => t.empresa_id));

    const fechas = [];
    const inicio = parseDateLocal(startDate);
    const fin = parseDateLocal(endDate);

    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      fechas.push(formatDateOnly(new Date(d)));
    }

    const fechasLimitadas = fechas.slice(0, Math.min(parseInt(limit), 10000));

    const resultadosPorFecha = [];
    const nombreProyectoCol = {};

    for (const empresa_id_val of [...new Set(trabajadoresList.map(t => t.empresa_id))]) {
      const trabajadoresDeEmpresa = trabajadoresList.filter(t => t.empresa_id === empresa_id_val).map(t => t.nombre);
      const registrosAsignados = REGISTROS_POR_EMPRESA[empresa_id_val] || [];
      if (!registrosAsignados.length) continue;

      const lowerNames = trabajadoresDeEmpresa.map(n => String(n).trim().toLowerCase());
      let pr = 0;
      const unionParts = [];
      for (const registro of registrosAsignados) {
        const { tabla, campoNombre, campoFecha } = registro;
        if (!(tabla in nombreProyectoCol)) {
          try {
            const candidates = ['nombre_proyecto','nombre_obra','obra','obra_nombre'];
            let found = null;
            for (const c of candidates) {
              try {
                const colQ = `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`;
                const colR = await db.query(colQ, [tabla, c]);
                if (colR.rows && colR.rows.length > 0) { found = c; break; }
              } catch (e) {
                // ignorar error al sondear columna
              }
            }
            nombreProyectoCol[tabla] = found;
          } catch (err) {
            nombreProyectoCol[tabla] = null;
          }
        }

        const colName = nombreProyectoCol[tabla];
        if (colName) {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, ${colName} AS nombre_proyecto, '${tabla}' AS formato, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[])`);
        } else {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, NULL::text AS nombre_proyecto, '${tabla}' AS formato, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[])`);
        }
      }

      if (!unionParts.length) continue;

      const finalQuery = `SELECT nombre, fecha, COALESCE((ARRAY_AGG(nombre_proyecto ORDER BY pr) FILTER (WHERE nombre_proyecto IS NOT NULL))[1],'') AS nombre_proyecto, ARRAY_AGG(DISTINCT formato) AS formatos_llenos, COUNT(*) AS total_registros FROM ( ${unionParts.join(' UNION ALL ')} ) t GROUP BY nombre, fecha ORDER BY nombre, fecha`;

      let aggregated = [];
      try {
        console.log(`[REGISTROS_DIARIOS][DESCARGAR] Ejecutando consulta agregada empresa=${empresa_id_val}`);
        const agR = await db.query(finalQuery, [startDate, endDate, lowerNames]);
        aggregated = agR.rows || [];
      } catch (err) {
        console.error('Error en consulta agregada por empresa', empresa_id_val, err);
        aggregated = [];
      }

      const map = new Map();
      for (const r of aggregated) {
        const fechaKey = formatDateOnly(r.fecha);
        const key = `${String(r.nombre).toLowerCase()}_${fechaKey}`;
        map.set(key, { total_registros: parseInt(r.total_registros || 0), nombre_proyecto: r.nombre_proyecto || '', formatos_llenos: r.formatos_llenos || [] });
      }

      const expectedFormatos = registrosAsignados.map(r => r.tabla);
      for (const nombreTrabajador of trabajadoresDeEmpresa) {
        for (const fecha of fechasLimitadas) {
          const key = `${String(nombreTrabajador).trim().toLowerCase()}_${fecha}`;
          const entry = map.get(key) || { total_registros: 0, nombre_proyecto: '', formatos_llenos: [] };
          const filled = (entry.formatos_llenos || []).map(String);
          const faltantes = expectedFormatos.filter(e => !filled.includes(e));
          resultadosPorFecha.push({ fecha, nombre: nombreTrabajador, empresa: empresasMap[empresa_id_val] || empresa_id_val, nombre_proyecto: entry.nombre_proyecto, total_registros: entry.total_registros, formatos_llenos: filled, formatos_faltantes: faltantes });
        }
      }
    }

    const filenameUser = (typeof nombre === 'string' && nombre.trim()) ? nombre.replace(/\s+/g, '_') : 'todos';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registros_diarios_${filenameUser}_${startDate}_${endDate}.xlsx"`);

    const workbookWriter = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res });
    const worksheet = workbookWriter.addWorksheet('Registros Diarios');

    worksheet.columns = [
      { header: 'Fecha', key: 'fecha', width: 15 },
      { header: 'Nombre Usuario', key: 'nombre', width: 30 },
      { header: 'Empresa', key: 'empresa', width: 30 },
      { header: 'Nombre Proyecto', key: 'nombre_proyecto', width: 30 },
      { header: 'Total Registros', key: 'total_registros', width: 16 },
      { header: 'Formatos Llenos', key: 'formatos_llenos', width: 40 },
      { header: 'Formatos Faltantes', key: 'formatos_faltantes', width: 40 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.commit();

    let written = 0;
    for (const row of resultadosPorFecha) {
      const r = worksheet.addRow({
        fecha: row.fecha,
        nombre: row.nombre,
        empresa: row.empresa || '',
        nombre_proyecto: row.nombre_proyecto || '',
        total_registros: row.total_registros,
        formatos_llenos: (row.formatos_llenos || []).join(', '),
        formatos_faltantes: (row.formatos_faltantes || []).join(', ')
      });
      r.commit();
      written++;
    }

    console.log(`[DESCARGAR REGISTROS DIARIOS] Escribiendo ${written} filas en Excel (stream)`);
    await workbookWriter.commit();

  } catch (error) {
    console.error("Error en /registros_diarios/descargar:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Error al generar archivo Excel",
        detalle: error.message
      });
    }
  }
});

export default router;
