import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
const router = express.Router();

// Helper: construye WHERE dinámico y values parametrizados
function buildWhere(params, allowedFields) {
  const clauses = [];
  const values = [];
  let idx = 1;
  for (const key of Object.keys(params)) {
    const val = params[key];
    if ((val === undefined || val === '') || !allowedFields.includes(key)) continue;
    if (key === 'fecha_from') {
      // comparar solo la parte date para evitar problemas TZ
      clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`);
      values.push(val);
    } else if (key === 'fecha_to') {
      clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`);
      values.push(val);
    } else if (key === 'fecha') {
      clauses.push(`CAST(fecha_servicio AS date) = $${idx++}`);
      values.push(val);
    } else {
      // busqueda case-insensitive parcial
      clauses.push(`${key} ILIKE $${idx++}`);
      values.push(`%${val}%`);
    }
  }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', values };
}

// Helper: normaliza una entrada de fecha a YYYY-MM-DD (fecha local)
// Acepta string "YYYY-MM-DD" o Date, evita new Date("YYYY-MM-DD") que causa shifts por TZ
function formatDateOnly(input) {
  if (!input) return null;
  // Si ya es Date, formatear por partes
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const d = input;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(input).trim();
  // Si viene en formato YYYY-MM-DD, usarlo directamente con padding seguro
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, '0');
    const da = String(m[3]).padStart(2, '0');
    return `${y}-${mo}-${da}`;
  }
  // Fallback: intentar parsear y devolver fecha local (solo por compatibilidad)
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Helper: devuelve la fecha de hoy en YYYY-MM-DD
function todayDateString() {
  return formatDateOnly(new Date());
}

// GET /permiso_trabajo -> lista paginada
router.get('/permiso_trabajo', async (req, res) => {
  try {
    const pool = global.db;
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = parseInt(req.query.offset) || 0;
    const q = await pool.query(
      `SELECT * FROM permiso_trabajo ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error fetching permiso_trabajo list:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /permiso_trabajo/:id -> obtener por id
router.get('/permiso_trabajo/:id', async (req, res) => {
  try {
    const pool = global.db;
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ success: false, error: 'ID inválido' });
    const q = await pool.query(`SELECT * FROM permiso_trabajo WHERE id = $1`, [id]);
    if (q.rows.length === 0) return res.status(404).json({ success: false, error: 'Registro no encontrado' });
    res.json({ success: true, row: q.rows[0] });
  } catch (err) {
    console.error('Error fetching permiso_trabajo by id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /permiso_trabajo/search -> búsquedas flexibles usando query params
// Permite: cliente_constructora (nombre_cliente), nombre_proyecto, fecha (YYYY-MM-DD), fecha_from, fecha_to, nombre_operador, nombre_responsable, limite/offset
router.get('/permiso_trabajo/search', async (req, res) => {
  try {
    const pool = global.db;
    // Si se pasó fecha_from pero no fecha_to, usar hoy como fecha_to
    if (req.query && req.query.fecha_from && !req.query.fecha_to) {
      req.query.fecha_to = todayDateString();
    }
    // Mapar nombres de query a columnas de la tabla permiso_trabajo
    const allowed = [
      'nombre_cliente', 'nombre_proyecto', 'fecha', 'fecha_from', 'fecha_to',
      'nombre_operador', 'nombre_responsable', 'nombre_suspende', 'motivo_suspension'
    ];

    const { where, values } = buildWhere(req.query, allowed);

    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    // añadir limit y offset a values
    const finalQuery = `SELECT * FROM permiso_trabajo ${where} ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    const finalValues = [...values, limit, offset];

    const q = await pool.query(finalQuery, finalValues);
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error searching permiso_trabajo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /all -> resumen y lista de permiso_trabajo (útil para panel administrador)
router.get('/all', async (req, res) => {
  try {
    const pool = global.db;
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const q = await pool.query(`SELECT * FROM permiso_trabajo ORDER BY id DESC LIMIT $1`, [limit]);
    const totalCountRes = await pool.query(`SELECT COUNT(*)::int AS total FROM permiso_trabajo`);
    res.json({
      success: true,
      total: totalCountRes.rows[0].total,
      permisos: q.rows
    });
  } catch (err) {
    console.error('Error fetching all permiso_trabajo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /buscar -> filtros desde frontend (nombre, cedula, obra, constructora, fecha_inicio, fecha_fin)
router.post('/buscar', async (req, res) => {
  try {
    const pool = global.db;
    const { nombre, cedula, obra, constructora, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    // Normalizar fechas a YYYY-MM-DD para comparaciones inclusivas
    const startDate = formatDateOnly(fecha_inicio);
    // si no se envía fecha_fin, usar hoy
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    // Construir where dinámico — solo en tabla permiso_trabajo
    const clauses = [];
    const values = [];
    let idx = 1;

    if (nombre) {
      // buscar en nombre_operador, nombre_responsable, nombre_suspende
      clauses.push(`(nombre_operador ILIKE $${idx} OR nombre_responsable ILIKE $${idx} OR nombre_suspende ILIKE $${idx})`);
      values.push(`%${nombre}%`);
      idx++;
    }
    // cedula no existe en esta tabla; lo aceptamos pero no lo usamos (se podría extender con JOIN)
    if (obra) {
      clauses.push(`nombre_proyecto ILIKE $${idx++}`);
      values.push(`%${obra}%`);
    }
    if (constructora) {
      clauses.push(`nombre_cliente ILIKE $${idx++}`);
      values.push(`%${constructora}%`);
    }
    if (startDate) {
      clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`);
      values.push(startDate);
    }
    if (endDate) {
      // comparamos por date para incluir todo el día final independientemente del timezone
      clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`);
      values.push(endDate);
    }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const q = await pool.query(
      `SELECT * FROM permiso_trabajo ${where} ORDER BY id DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, Math.min(1000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    // Transformar filas al formato esperado por el front
    const rows = q.rows.map(r => ({
      fecha: r.fecha_servicio ? r.fecha_servicio.toISOString().slice(0,10) : null,
      nombre: r.nombre_operador || '',
      cedula: null, // no disponible en permiso_trabajo
      empresa: r.nombre_responsable || '',
      obra: r.nombre_proyecto || '',
      constructora: r.nombre_cliente || '',
      raw: r // para referencia
    }));

    res.json({ success: true, count: q.rowCount, rows });
  } catch (err) {
    console.error('Error en /permiso_trabajo_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Genera PDF resumen de permisos (mantener si se usa en otro lugar)
async function generarPDFPermisos(rows) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));
      doc.fontSize(18).text('Permisos de Trabajo', { align: 'center' });
      doc.moveDown();
      rows.forEach((r, i) => {
        doc.fontSize(12).text(`${i + 1}. ID: ${r.id}  Fecha: ${r.fecha_servicio ? r.fecha_servicio.toISOString().slice(0,10) : ''}`);
        doc.text(`   Cliente/Constructora: ${r.nombre_cliente || ''}`);
        doc.text(`   Proyecto/Obra: ${r.nombre_proyecto || ''}`);
        doc.text(`   Operador: ${r.nombre_operador || ''}   Cargo: ${r.cargo || ''}`);
        if (r.observaciones) doc.text(`   Observaciones: ${r.observaciones}`);
        doc.moveDown(0.5);
        if ((i + 1) % 20 === 0) doc.addPage();
      });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Nueva: genera un PDF de una sola hoja para un permiso (Buffer)
async function generarPDFPorPermiso(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));
      doc.fontSize(16).text(`Permiso de Trabajo - ID: ${r.id}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : ''}`);
      doc.text(`Cliente / Constructora: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto / Obra: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Cargo: ${r.cargo || ''}`);
      doc.moveDown();
      // Añadir la mayoría de campos relevantes en formato key: value
      const campos = [
        'trabajo_rutinario','tarea_en_alturas','altura_inicial','altura_final',
        'herramientas_seleccionadas','herramientas_otros',
        'certificado_alturas','seguridad_social_arl','casco_tipo1','gafas_seguridad',
        'proteccion_auditiva','proteccion_respiratoria','guantes_seguridad','botas_punta_acero',
        'ropa_reflectiva','arnes_cuerpo_entero','mosqueton','arrestador_caidas','linea_vida',
        'observaciones','motivo_suspension','nombre_suspende','nombre_responsable'
      ];
      campos.forEach(key => {
        if (r[key] !== undefined && r[key] !== null && String(r[key]).toString().trim() !== '') {
          doc.fontSize(11).text(`${key.replace(/_/g,' ')}: ${r[key]}`);
        }
      });
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// POST /descargar -> genera CSV y lo devuelve como blob. body: mismos filtros + formato: 'excel'|'pdf'
router.post('/descargar', async (req, res) => {
  try {
    const pool = global.db;
    const { nombre, cedula, obra, constructora, fecha_inicio, fecha_fin, formato = 'excel', limit = 10000 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    // si no se envía fecha_fin, usar hoy
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;

    if (nombre) {
      clauses.push(`(nombre_operador ILIKE $${idx} OR nombre_responsable ILIKE $${idx} OR nombre_suspende ILIKE $${idx})`);
      values.push(`%${nombre}%`);
      idx++;
    }
    if (obra) {
      clauses.push(`nombre_proyecto ILIKE $${idx++}`);
      values.push(`%${obra}%`);
    }
    if (constructora) {
      clauses.push(`nombre_cliente ILIKE $${idx++}`);
      values.push(`%${constructora}%`);
    }
    if (startDate) {
      clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`);
      values.push(startDate);
    }
    if (endDate) {
      clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`);
      values.push(endDate);
    }

    // Si piden Excel -> generar XLSX y devolver (sin generar/enviar PDF automáticamente)
    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Permisos de Trabajo');

      // Lista de columnas/keys que queremos volcar al Excel (puedes ajustar el orden)
      const keys = [
        'id',
        'nombre_cliente', 'nombre_proyecto', 'fecha_servicio',
        'nombre_operador', 'cargo',
        'trabajo_rutinario', 'tarea_en_alturas', 'altura_inicial', 'altura_final',
        'herramientas_seleccionadas', 'herramientas_otros',
        'certificado_alturas', 'seguridad_social_arl', 'casco_tipo1', 'gafas_seguridad',
        'proteccion_auditiva', 'proteccion_respiratoria', 'guantes_seguridad', 'botas_punta_acero',
        'ropa_reflectiva', 'arnes_cuerpo_entero', 'arnes_cuerpo_entero_dielectico', 'mosqueton',
        'arrestador_caidas', 'eslinga_absorbedor', 'eslinga_posicionamiento', 'linea_vida',
        'eslinga_doble', 'verificacion_anclaje', 'procedimiento_charla', 'medidas_colectivas_prevencion',
        'epp_epcc_buen_estado', 'equipos_herramienta_buen_estado', 'inspeccion_sistema', 'plan_emergencia_rescate',
        'medidas_caida', 'kit_rescate', 'permisos', 'condiciones_atmosfericas', 'distancia_vertical_caida',
        'otro_precausiones', 'vertical_fija', 'vertical_portatil', 'andamio_multidireccional', 'andamio_colgante',
        'elevador_carga', 'canasta', 'ascensores', 'otro_equipos',
        'observaciones', 'motivo_suspension', 'nombre_suspende', 'nombre_responsable', 'nombre_coordinador'
      ];

      // Definir columnas del worksheet
      ws.columns = keys.map(k => ({ header: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), key: k, width: 18 }));

      // Añadir filas: normalizamos fecha y valores nulos
      q.rows.forEach(r => {
        const rowObj = {};
        keys.forEach(k => {
          if (k === 'fecha_servicio') {
            rowObj[k] = r[k] ? (new Date(r[k])).toISOString().slice(0,10) : '';
          } else {
            rowObj[k] = r[k] !== undefined && r[k] !== null ? r[k] : '';
          }
        });
        ws.addRow(rowObj);
      });

      // Auto width (opcional ligero): limitar a 50
      ws.columns.forEach(col => {
        if (!col.width || col.width < 12) col.width = 12;
        if (col.width > 50) col.width = 50;
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=permisos_trabajo.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    // Si piden PDF -> generar un PDF por permiso y devolver un ZIP con todos los PDFs
    if (formato === 'pdf') {
      if (!q.rows || q.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'No se encontraron permisos para exportar' });
      }

      // Preparar headers para ZIP
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="permisos_trabajo.zip"');

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => {
        console.error('Archiver error:', err);
        try { res.status(500).end(); } catch(e){/* ignore */ }
      });
      archive.pipe(res);

      // Generar PDFs secuencialmente y añadir al zip
      for (const r of q.rows) {
        try {
          const pdfBuf = await generarPDFPorPermiso(r);
          const safeName = `permiso_${r.id}.pdf`;
          archive.append(pdfBuf, { name: safeName });
        } catch (pdfErr) {
          console.error(`Error generando PDF para permiso id=${r.id}:`, pdfErr);
          // añadir un archivo de texto indicando error para ese id
          const errTxt = `Error generating PDF for permiso id=${r.id}: ${pdfErr.message || pdfErr}`;
          archive.append(errTxt, { name: `permiso_${r.id}_error.txt` });
        }
      }

      // Finalizar y dejar que la respuesta se cierre cuando termine el stream
      await archive.finalize();
      return; // la respuesta se cierra por el stream del archive
    }

    // Fallback CSV (si formato no reconocido)
    const header = ['id','fecha','nombre','cedula','empresa','obra','constructora'];
    const lines = [header.join(',')];
    for (const r of q.rows) {
      const fecha = r.fecha_servicio ? r.fecha_servicio.toISOString().slice(0,10) : '';
      const nombreOp = (r.nombre_operador || '').replace(/"/g, '""');
      const ced = ''; // no disponible en permiso_trabajo
      const empresa = (r.nombre_responsable || '').replace(/"/g, '""');
      const obraVal = (r.nombre_proyecto || '').replace(/"/g, '""');
      const constructoraVal = (r.nombre_cliente || '').replace(/"/g, '""');
      const row = [
        r.id,
        `"${fecha}"`,
        `"${nombreOp}"`,
        `"${ced}"`,
        `"${empresa}"`,
        `"${obraVal}"`,
        `"${constructoraVal}"`
      ];
      lines.push(row.join(','));
    }
    const csv = lines.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="permiso_trabajo.csv"');
    return res.send(csv);
  } catch (err) {
    console.error('Error en /permiso_trabajo_admin/descargar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

