import { Router } from "express";
import ExcelJS from 'exceljs';
const router = Router();

// Middleware para verificar si la base de datos está disponible
router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de registros diarios");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

// Helper para formatear fecha YYYY-MM-DD
function formatDateOnly(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const d = input;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayDateString() { 
  return formatDateOnly(new Date()); 
}

// Helper: devuelve un map { [empresa_id]: nombre }
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

// Configuración de registros por empresa
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

// POST /buscar -> filtros en body JSON (para visualización)
router.post('/buscar', async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }
  console.log('POST /api/buscar payload:', req.body);

  try {
    const { nombre, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    // Obtener lista de trabajadores a procesar: si se recibe `nombre` se procesa solo ese,
    // si no se recibe, se procesan todos los trabajadores de la tabla.
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



    // Obtener nombres de empresas para reemplazar empresa_id por nombre (para /buscar)
    const empresasMap = await getEmpresasMap(db, trabajadoresList.map(t => t.empresa_id));


    // Generar array de fechas en el rango
    const fechas = [];
    const inicio = new Date(startDate);
    const fin = new Date(endDate);
    
    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      fechas.push(formatDateOnly(new Date(d)));
    }

    // Limitar fechas según limit y offset
    const fechasPaginadas = fechas.slice(offset, offset + parseInt(limit));

    // Verificar cada trabajador y cada fecha - optimizado por empresa
    const resultadosPorFecha = [];

    // Cache de columna de proyecto por tabla (null si no existe)
    const nombreProyectoCol = {};

    for (const empresa_id_val of [...new Set(trabajadoresList.map(t => t.empresa_id))]) {
      const trabajadoresDeEmpresa = trabajadoresList.filter(t => t.empresa_id === empresa_id_val).map(t => t.nombre);
      const registrosAsignados = REGISTROS_POR_EMPRESA[empresa_id_val] || [];
      if (!registrosAsignados.length) continue;

      // Preparar lista de nombres en minúscula y sin espacios para comparaciones más rápidas
      const lowerNames = trabajadoresDeEmpresa.map(n => String(n).trim().toLowerCase());

      // Construir UNION ALL a partir de las tablas asignadas
      let pr = 0;
      const unionParts = [];
      for (const registro of registrosAsignados) {
        const { tabla, campoNombre, campoFecha } = registro;
        // comprobar si la tabla tiene columna nombre_proyecto (cacheada)
        if (!(tabla in nombreProyectoCol)) {
          try {
            // probar varios nombres comunes de columna de proyecto
            const candidates = ['nombre_proyecto','nombre_obra','obra','obra_nombre'];
            let found = null;
            for (const c of candidates) {
              try {
                const colQ = `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2 LIMIT 1`;
                const colR = await db.query(colQ, [tabla, c]);
                if (colR.rows && colR.rows.length > 0) { found = c; break; }
              } catch (e) {
                // ignore
              }
            }
            nombreProyectoCol[tabla] = found; // e.g. 'nombre_proyecto' or null
          } catch (err) {
            nombreProyectoCol[tabla] = null;
          }
        }

        const colName = nombreProyectoCol[tabla];
        if (colName) {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, ${colName} AS nombre_proyecto, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[]) GROUP BY LOWER(TRIM(${campoNombre})), CAST(${campoFecha} AS date), ${colName}`);
        } else {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, NULL::text AS nombre_proyecto, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[]) GROUP BY LOWER(TRIM(${campoNombre})), CAST(${campoFecha} AS date)`);
        }
      }

      if (!unionParts.length) continue;

      const finalQuery = `SELECT nombre, fecha, COALESCE((ARRAY_AGG(nombre_proyecto ORDER BY pr) FILTER (WHERE nombre_proyecto IS NOT NULL))[1],'') AS nombre_proyecto, COUNT(*) AS total_registros FROM ( ${unionParts.join(' UNION ALL ')} ) t GROUP BY nombre, fecha ORDER BY nombre, fecha`;

      // Ejecutar la consulta una sola vez por empresa
      let aggregated = [];
      try {
        console.log(`[REGISTROS_DIARIOS] Ejecutando consulta agregada empresa=${empresa_id_val}`);
        console.log(finalQuery);
        console.log('params:', [startDate, endDate, lowerNames.slice(0,20)]);
        const agR = await db.query(finalQuery, [startDate, endDate, lowerNames]);
        aggregated = agR.rows || [];
        console.log(`[REGISTROS_DIARIOS] empresa=${empresa_id_val} filas agregadas=${aggregated.length}`);
        if (aggregated.length) console.log('ejemplo fila:', aggregated[0]);
      } catch (err) {
        console.error('Error en consulta agregada por empresa', empresa_id_val, err);
        aggregated = [];
      }

      // Mapear resultados para acceso rápido
      const map = new Map();
      for (const r of aggregated) {
        const fechaKey = formatDateOnly(r.fecha);
        const key = `${String(r.nombre).toLowerCase()}_${fechaKey}`;
        map.set(key, { total_registros: parseInt(r.total_registros || 0), nombre_proyecto: r.nombre_proyecto || '' });
      }

      // Rellenar fechas (paginated)
      for (const nombreTrabajador of trabajadoresDeEmpresa) {
        for (const fecha of fechasPaginadas) {
          const key = `${String(nombreTrabajador).trim().toLowerCase()}_${fecha}`;
          const entry = map.get(key) || { total_registros: 0, nombre_proyecto: '' };
          resultadosPorFecha.push({ fecha, nombre: nombreTrabajador, empresa: empresasMap[empresa_id_val] || empresa_id_val, nombre_proyecto: entry.nombre_proyecto, total_registros: entry.total_registros });
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

// POST /descargar -> genera Excel con datos de registros diarios
router.post('/descargar', async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }
  console.log('POST /api/descargar payload:', req.body);

  try {
    const { nombre, fecha_inicio, fecha_fin, limit = 10000 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    console.log(`[DESCARGAR REGISTROS DIARIOS] Usuario: ${nombre || '[TODOS]'}, Rango: ${startDate} - ${endDate}`);

    // Obtener lista de trabajadores a procesar: si se recibe `nombre` se procesa solo ese,
    // si no se recibe, se procesan todos los trabajadores de la tabla.
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

    // Obtener nombres de empresas para reemplazar empresa_id por nombre (para /descargar)
    const empresasMap = await getEmpresasMap(db, trabajadoresList.map(t => t.empresa_id));

    // Generar array de fechas en el rango
    const fechas = [];
    const inicio = new Date(startDate);
    const fin = new Date(endDate);
    
    for (let d = new Date(inicio); d <= fin; d.setDate(d.getDate() + 1)) {
      fechas.push(formatDateOnly(new Date(d)));
    }

    // Limitar cantidad de fechas
    const fechasLimitadas = fechas.slice(0, Math.min(parseInt(limit), 10000));

    console.log(`[DESCARGAR REGISTROS DIARIOS] Total de fechas a procesar: ${fechasLimitadas.length}`);

    // Verificar cada trabajador y cada fecha - optimizado por empresa (similar a /buscar)
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
                // ignore
              }
            }
            nombreProyectoCol[tabla] = found;
          } catch (err) {
            nombreProyectoCol[tabla] = null;
          }
        }

        const colName = nombreProyectoCol[tabla];
        if (colName) {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, ${colName} AS nombre_proyecto, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[]) GROUP BY LOWER(TRIM(${campoNombre})), CAST(${campoFecha} AS date), ${colName}`);
        } else {
          unionParts.push(`SELECT LOWER(TRIM(${campoNombre})) AS nombre, CAST(${campoFecha} AS date) AS fecha, NULL::text AS nombre_proyecto, ${pr++} AS pr FROM ${tabla} WHERE CAST(${campoFecha} AS date) BETWEEN $1 AND $2 AND LOWER(TRIM(${campoNombre})) = ANY($3::text[]) GROUP BY LOWER(TRIM(${campoNombre})), CAST(${campoFecha} AS date)`);
        }
      }

      if (!unionParts.length) continue;

      const finalQuery = `SELECT nombre, fecha, COALESCE((ARRAY_AGG(nombre_proyecto ORDER BY pr) FILTER (WHERE nombre_proyecto IS NOT NULL))[1],'') AS nombre_proyecto, COUNT(*) AS total_registros FROM ( ${unionParts.join(' UNION ALL ')} ) t GROUP BY nombre, fecha ORDER BY nombre, fecha`;

      let aggregated = [];
      try {
        console.log(`[REGISTROS_DIARIOS][DESCARGAR] Ejecutando consulta agregada empresa=${empresa_id_val}`);
        console.log(finalQuery);
        console.log('params:', [startDate, endDate, lowerNames.slice(0,20)]);
        const agR = await db.query(finalQuery, [startDate, endDate, lowerNames]);
        aggregated = agR.rows || [];
        console.log(`[REGISTROS_DIARIOS][DESCARGAR] empresa=${empresa_id_val} filas agregadas=${aggregated.length}`);
        if (aggregated.length) console.log('ejemplo fila:', aggregated[0]);
      } catch (err) {
        console.error('Error en consulta agregada por empresa', empresa_id_val, err);
        aggregated = [];
      }

      const map = new Map();
      for (const r of aggregated) {
        const fechaKey = formatDateOnly(r.fecha);
        const key = `${String(r.nombre).toLowerCase()}_${fechaKey}`;
        map.set(key, { total_registros: parseInt(r.total_registros || 0), nombre_proyecto: r.nombre_proyecto || '' });
      }

      for (const nombreTrabajador of trabajadoresDeEmpresa) {
        for (const fecha of fechasLimitadas) {
          const key = `${String(nombreTrabajador).trim().toLowerCase()}_${fecha}`;
          const entry = map.get(key) || { total_registros: 0, nombre_proyecto: '' };
          resultadosPorFecha.push({ fecha, nombre: nombreTrabajador, empresa: empresasMap[empresa_id_val] || empresa_id_val, nombre_proyecto: entry.nombre_proyecto, total_registros: entry.total_registros });
        }
      }
    }

    // Crear el Excel usando streaming para evitar buffers grandes
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
      { header: 'Total Registros', key: 'total_registros', width: 16 }
    ];

    // Estilo del encabezado
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.commit();

    // Escribir filas en streaming
    let written = 0;
    for (const row of resultadosPorFecha) {
      const r = worksheet.addRow({ fecha: row.fecha, nombre: row.nombre, empresa: row.empresa || '', nombre_proyecto: row.nombre_proyecto || '', total_registros: row.total_registros });
      r.commit();
      written++;
    }

    console.log(`[DESCARGAR REGISTROS DIARIOS] Escribiendo ${written} filas en Excel (stream)`);
    await workbookWriter.commit();
    // el stream (res) se cerrará cuando workbookWriter termine
    console.log(`[DESCARGAR REGISTROS DIARIOS] Archivo enviado exitosamente (stream)`);

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