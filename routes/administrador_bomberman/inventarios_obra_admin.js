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

// GET /inventarios_obra/search -> búsqueda por query params (opcional)
router.get('/inventarios_obra/search', async (req, res) => {
  try {
    const pool = global.db;
    if (req.query && req.query.fecha_from && !req.query.fecha_to) req.query.fecha_to = todayDateString();
    const allowed = ['nombre_cliente','nombre_proyecto','fecha','fecha_from','fecha_to','nombre_operador','cargo'];
    const { where, values } = buildWhere(req.query, allowed);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    const finalQuery = `SELECT * FROM inventario_obra ${where} ORDER BY id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    const q = await pool.query(finalQuery, [...values, limit, offset]);
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error searching inventario_obra:', err);
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
      clauses.push(`(nombre_operador ILIKE $${idx} OR nombre_responsable ILIKE $${idx})`);
      values.push(`%${nombre}%`); idx++;
    }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const q = await pool.query(
      `SELECT * FROM inventario_obra ${where} ORDER BY id DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, Math.min(1000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    const rows = q.rows.map(r => ({
      fecha: r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : null,
      nombre: r.nombre_operador || '',
      cedula: r.numero_identificacion || null,
      empresa: r.nombre_responsable || '',
      obra: r.nombre_proyecto || '',
      constructora: r.nombre_cliente || '',
      raw: r
    }));

    res.json({ success: true, count: q.rowCount, rows });
  } catch (err) {
    console.error('Error en /inventarios_obra_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// genera PDF de una inspección en una sola hoja (Buffer)
async function generarPDFPorInventarioObra(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(16).text(`Inventario Obra - ID: ${r.id}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : ''}`);
      doc.text(`Cliente: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Cargo: ${r.cargo || ''}`);
      doc.moveDown();
      // incluir todos los campos del inventario_obra
      Object.entries(r).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '' && !['id','fecha_servicio','nombre_cliente','nombre_proyecto','nombre_operador','cargo'].includes(k)) {
          doc.fontSize(11).text(`${k.replace(/_/g,' ')}: ${v}`);
        }
      });
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
    if (nombre) { clauses.push(`(nombre_operador ILIKE $${idx} OR nombre_responsable ILIKE $${idx})`); values.push(`%${nombre}%`); idx++; }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const q = await pool.query(`SELECT * FROM inventario_obra ${where} ORDER BY id DESC LIMIT $${idx}`, [...values, Math.min(50000, parseInt(limit) || 10000)]);

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Inventario Obra');

      // Si no hay filas, devolver un libro vacío con una hoja y salir
      if (!q.rows || q.rows.length === 0) {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=inventarios_obra.xlsx');
        await workbook.xlsx.write(res);
        return res.end();
      }

      // Formato vertical (ficha): cada registro como bloque Campo | Valor
      const keys = Object.keys(q.rows[0]);
      
      // Configurar columnas
      ws.columns = [
        { header: 'Campo', key: 'campo', width: 30 },
        { header: 'Valor', key: 'valor', width: 50 }
      ];

      // Estilo para encabezado de cada registro
      const headerStyle = {
        font: { bold: true, color: { argb: 'FFFFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } },
        alignment: { horizontal: 'center' }
      };

      // Estilo para campos
      const campoStyle = {
        font: { bold: true },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }
      };

      let currentRow = 2; // Empezar después del header

      q.rows.forEach((r, index) => {
        // Título del registro
        ws.mergeCells(`A${currentRow}:B${currentRow}`);
        const titleCell = ws.getCell(`A${currentRow}`);
        titleCell.value = `REGISTRO ${index + 1} - ID: ${r.id}`;
        titleCell.style = headerStyle;
        currentRow++;

        // Cada campo como fila
        keys.forEach(k => {
          let val = r[k];
          
          // Formatear valor
          if (k === 'fecha_servicio') {
            try {
              if (val) {
                const d = new Date(val);
                val = !Number.isNaN(d.getTime()) ? d.toISOString().slice(0,10) : String(val);
              } else {
                val = '';
              }
            } catch (e) { val = val ? String(val) : ''; }
          } else if (val === null || val === undefined) {
            val = '';
          } else if (val instanceof Date) {
            try {
              val = !Number.isNaN(val.getTime()) ? val.toISOString().slice(0,10) : '';
            } catch (e) { val = ''; }
          } else if (Buffer.isBuffer(val)) {
            val = '[Buffer]';
          } else if (typeof val === 'object') {
            try { val = JSON.stringify(val); } catch (e) { val = String(val); }
          }

          const row = ws.getRow(currentRow);
          row.getCell(1).value = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          row.getCell(1).style = campoStyle;
          row.getCell(2).value = val;
          currentRow++;
        });

        // Línea vacía entre registros
        currentRow++;
      });

      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=inventarios_obra.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!q.rows || q.rows.length === 0) return res.status(404).json({ success: false, error: 'No se encontraron registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="inventarios_obra.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { console.error('Archiver error:', err); try{ res.status(500).end(); } catch(e){} });
      archive.pipe(res);
      for (const r of q.rows) {
        try {
          const pdfBuf = await new Promise((resolve, reject) => {
            try {
              const doc = new PDFDocument({ margin: 30, size: 'A4' });
              const bufs = [];
              doc.on('data', b => bufs.push(b));
              doc.on('end', () => resolve(Buffer.concat(bufs)));

              doc.fontSize(16).text(`Inventario Obra - ID: ${r.id}`, { align: 'center' });
              doc.moveDown();
              doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : ''}`);
              doc.text(`Cliente: ${r.nombre_cliente || ''}`);
              doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
              doc.text(`Operador: ${r.nombre_operador || ''}`);
              doc.text(`Cargo: ${r.cargo || ''}`);
              doc.moveDown();
              // Incluir todos los campos, incluidas observaciones
              Object.entries(r).forEach(([k, v]) => {
                if (v !== undefined && v !== null && String(v).trim() !== '') {
                  doc.fontSize(11).text(`${k.replace(/_/g,' ')}: ${v}`);
                }
              });
              doc.end();
            } catch (err) { reject(err); }
          });
          archive.append(pdfBuf, { name: `inventario_obra_${r.id}.pdf` });
        } catch (pdfErr) {
          archive.append(`Error generando PDF para id=${r.id}: ${pdfErr.message||pdfErr}`, { name: `inventario_obra_${r.id}_error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    // fallback CSV
    const keys = q.rows[0] ? Object.keys(q.rows[0]) : [];
    const header = keys.length ? keys : ['id','fecha','operador','obra','cliente'];
    const lines = [header.join(',')];
    for (const r of q.rows) {
      const rowArr = header.map(k => {
        let val = r[k];
        if (k === 'fecha_servicio') {
          try {
            if (val) {
              const d = new Date(val);
              val = !Number.isNaN(d.getTime()) ? d.toISOString().slice(0,10) : String(val);
            } else {
              val = '';
            }
          } catch (e) { val = val ? String(val) : ''; }
        } else if (val === null || val === undefined) {
          val = '';
        } else if (val instanceof Date) {
          try {
            val = !Number.isNaN(val.getTime()) ? val.toISOString().slice(0,10) : '';
          } catch (e) { val = ''; }
        } else if (Buffer.isBuffer(val)) {
          val = '[Buffer]';
        } else if (typeof val === 'object') {
          try { val = JSON.stringify(val); } catch (e) { val = String(val); }
        }
        return `"${String(val).replace(/"/g,'""')}"`;
      });
      lines.push(rowArr.join(','));
    }
    const csv = lines.join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="inventarios_obra.csv"');
    return res.send(csv);

  } catch (err) {
    console.error('Error en /inventarios_obra_admin/descargar:', err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export default router;
