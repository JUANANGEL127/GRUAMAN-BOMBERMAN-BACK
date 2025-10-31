import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
const router = express.Router();

// Helper: formatea string "YYYY-MM-DD" de forma segura (evita shift TZ)
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
function todayDateString() { return formatDateOnly(new Date()); }

// Helper para construir WHERE dinámico (usa CAST(...) AS date para fecha)
function buildWhere(params, allowedFields) {
  const clauses = [];
  const values = [];
  let idx = 1;
  for (const key of Object.keys(params)) {
    const val = params[key];
    if ((val === undefined || val === '') || !allowedFields.includes(key)) continue;
    if (key === 'fecha_from') {
      clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`);
      values.push(val);
    } else if (key === 'fecha_to') {
      clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`);
      values.push(val);
    } else if (key === 'fecha') {
      clauses.push(`CAST(fecha_servicio AS date) = $${idx++}`);
      values.push(val);
    } else {
      clauses.push(`${key} ILIKE $${idx++}`);
      values.push(`%${val}%`);
    }
  }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', values };
}

// GET /planilla_bombeo/search -> búsqueda por query params (opcional)
router.get('/planilla_bombeo/search', async (req, res) => {
  try {
    const pool = global.db;
    if (req.query && req.query.fecha_from && !req.query.fecha_to) req.query.fecha_to = todayDateString();
    const allowed = ['nombre_cliente','nombre_proyecto','fecha','fecha_from','fecha_to','nombre_operador','bomba_numero'];
    const { where, values } = buildWhere(req.query, allowed);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    const finalQuery = `SELECT * FROM planilla_bombeo ${where} ORDER BY id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    const q = await pool.query(finalQuery, [...values, limit, offset]);
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error searching planilla_bombeo:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /buscar -> filtros en body JSON
router.post('/buscar', async (req, res) => {
  try {
    const pool = global.db;
    const { nombre, cedula, obra, constructora, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;

    if (nombre) {
      clauses.push(`(pb.nombre_operador ILIKE $${idx} OR pb.nombre_auxiliar ILIKE $${idx})`);
      values.push(`%${nombre}%`); idx++;
    }
    if (obra) { clauses.push(`pb.nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`pb.nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(pb.fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(pb.fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    // Consulta para traer planillas y sus remisiones asociadas (array)
    const q = await pool.query(
      `SELECT pb.*, 
        COALESCE(
          (
            SELECT json_agg(r.*) 
            FROM remisiones r 
            WHERE r.planilla_bombeo_id = pb.id
          ), '[]'
        ) AS remisiones
       FROM planilla_bombeo pb
       ${where}
       ORDER BY pb.id DESC
       LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, Math.min(1000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    // remisiones debe ser array de objetos, no string
    const rows = q.rows.map(r => ({
      fecha: r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : null,
      nombre: r.nombre_operador || '',
      cedula: r.numero_identificacion || null,
      empresa: r.empresa_id || '',
      obra: r.nombre_proyecto || '',
      constructora: r.nombre_cliente || '',
      remisiones: Array.isArray(r.remisiones) ? r.remisiones : [],
      raw: r
    }));

    res.json({ success: true, count: q.rowCount, rows });
  } catch (err) {
    console.error('Error en /planilla_bombeo_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// genera PDF de una inspección en una sola hoja (Buffer)
async function generarPDFPorPlanilla(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(16).text(`Planilla Bombeo - ID: ${r.id}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : ''}`);
      doc.text(`Cliente: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Bomba: ${r.bomba_numero || ''}`);
      doc.moveDown();
      // incluir campos importantes de planilla_bombeo
      const campos = [
        'hora_llegada_obra','hora_salida_obra','hora_inicio_acpm','hora_final_acpm','horometro_inicial','horometro_final',
        'nombre_auxiliar','total_metros_cubicos_bombeados','remision','metros','observaciones'
      ];
      campos.forEach(k => {
        if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') {
          doc.fontSize(11).text(`${k.replace(/_/g,' ')}: ${r[k]}`);
        }
      });

      // Incluir remisiones en el mismo PDF
      if (Array.isArray(r.remisiones) && r.remisiones.length > 0) {
        doc.moveDown();
        doc.fontSize(13).text('Remisiones:', { underline: true });
        r.remisiones.forEach((rem, idx) => {
          doc.moveDown(0.5);
          doc.fontSize(12).text(`Remisión #${idx+1}`, { underline: false });
          Object.entries(rem).forEach(([k, v]) => {
            doc.fontSize(11).text(`${k.replace(/_/g, ' ')}: ${v}`);
          });
        });
      }

      doc.end();
    } catch (err) { reject(err); }
  });
}

// POST /descargar -> genera XLSX o ZIP de PDFs
router.post('/descargar', async (req, res) => {
  try {
    const pool = global.db;
    const { nombre, cedula, obra, constructora, fecha_inicio, fecha_fin, formato = 'excel', limit = 10000 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`(pb.nombre_operador ILIKE $${idx} OR pb.nombre_auxiliar ILIKE $${idx})`); values.push(`%${nombre}%`); idx++; }
    if (obra) { clauses.push(`pb.nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`pb.nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(pb.fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(pb.fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    // Consulta para traer planillas y sus remisiones asociadas (array)
    const q = await pool.query(
      `SELECT pb.*, 
        COALESCE(
          (
            SELECT json_agg(r.*) 
            FROM remisiones r 
            WHERE r.planilla_bombeo_id = pb.id
          ), '[]'
        ) AS remisiones
       FROM planilla_bombeo pb
       ${where}
       ORDER BY pb.id DESC
       LIMIT $${idx}`,
      [...values, Math.min(50000, parseInt(limit) || 10000)]
    );

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Planilla Bombeo');

      // Si no hay filas, devolver un libro vacío con una hoja y salir
      if (!q.rows || q.rows.length === 0) {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=planilla_bombeo.xlsx');
        await workbook.xlsx.write(res);
        return res.end();
      }

      // Usar las claves de la primera fila para construir todas las columnas dinámicamente
      const keys = Object.keys(q.rows[0]);
      ws.columns = keys.map(k => ({
        header: k.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()),
        key: k,
        width: 20
      }));

      // Añadir filas completas; formatear fecha_servicio y convertir valores no primitivos
      q.rows.forEach(r => {
        const rowObj = {};
        keys.forEach(k => {
          let val = r[k];
          if (k === 'fecha_servicio') {
            val = val ? (new Date(val)).toISOString().slice(0,10) : '';
          } else if (val === null || val === undefined) {
            val = '';
          } else if (typeof val === 'object' && k !== 'remisiones') {
            try { val = JSON.stringify(val); } catch (e) { val = String(val); }
          }
          rowObj[k] = val;
        });
        // Agregar remisiones como columna extra (JSON)
        rowObj['remisiones'] = JSON.stringify(r.remisiones || []);
        ws.addRow(rowObj);
      });

      // Ajuste ligero de anchuras (opcional)
      ws.columns.forEach(col => {
        if (!col.width || col.width < 12) col.width = 12;
        if (col.width > 60) col.width = 60;
      });

      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=planilla_bombeo.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!q.rows || q.rows.length === 0) return res.status(404).json({ success: false, error: 'No se encontraron registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="planilla_bombeo.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { console.error('Archiver error:', err); try{ res.status(500).end(); } catch(e){} });
      archive.pipe(res);
      for (const r of q.rows) {
        try {
          const pdfBuf = await generarPDFPorPlanilla(r);
          archive.append(pdfBuf, { name: `planilla_bombeo_${r.id}.pdf` });
        } catch (pdfErr) {
          archive.append(`Error generando PDF para id=${r.id}: ${pdfErr.message||pdfErr}`, { name: `planilla_bombeo_${r.id}_error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    // fallback CSV
    const header = ['id','fecha','operador','obra','cliente','remisiones'];
    const lines = [header.join(',')];
    for (const r of q.rows) {
      const fecha = r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : '';
      const nombreOp = (r.nombre_operador||'').replace(/"/g,'""');
      const obraVal = (r.nombre_proyecto||'').replace(/"/g,'""');
      const cliente = (r.nombre_cliente||'').replace(/"/g,'""');
      const remisiones = JSON.stringify(r.remisiones||[]);
      lines.push([r.id, `"${fecha}"`, `"${nombreOp}"`, `"${obraVal}"`, `"${cliente}"`, `"${remisiones}"`].join(','));
    }
    const csv = lines.join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="planilla_bombeo.csv"');
    return res.send(csv);

  } catch (err) {
    console.error('Error en /planilla_bombeo_admin/descargar:', err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export default router;
