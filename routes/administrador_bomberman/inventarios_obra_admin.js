import express from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import libre from 'libreoffice-convert';
import dotenv from 'dotenv';
dotenv.config();
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


// Genera un Excel llenando el template con los datos de un registro
async function generarExcelPorInventarioObra(r) {
  const candidatePaths = [
    path.join(process.cwd(), 'templates', 'inventario_obras_admin_template.xlsx'),
    path.join(process.cwd(), 'routes', 'templates', 'inventario_obras_admin_template.xlsx'),
    path.join(process.cwd(), 'routes', 'administrador_bomberman', 'templates', 'inventario_obras_admin_template.xlsx')
  ];
  const tplPath = candidatePaths.find(p => fs.existsSync(p));
  if (!tplPath) throw new Error('Template XLSX no encontrado en ninguna ruta esperada.');

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(tplPath);

  const data = {};
  Object.keys(r).forEach(k => {
    let v = r[k];
    if (k === 'fecha_servicio') v = v ? (new Date(v)).toISOString().slice(0,10) : '';
    else if (v === null || v === undefined) v = '';
    else if (typeof v === 'object') { try { v = JSON.stringify(v); } catch(e){ v = String(v); } }
    data[k] = String(v);
  });
  workbook.eachSheet(sheet => {
    sheet.eachRow(row => {
      row.eachCell(cell => {
        if (typeof cell.value === 'string') {
          cell.value = cell.value.replace(/{{\s*([\w]+)\s*}}/g, (m, p1) => (data[p1] !== undefined ? data[p1] : ''));
        } else if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
          const txt = cell.value.richText.map(t => t.text).join('');
          const replaced = txt.replace(/{{\s*([\w]+)\s*}}/g, (m, p1) => (data[p1] !== undefined ? data[p1] : ''));
          cell.value = replaced;
        }
      });
    });
  });

  const buf = await workbook.xlsx.writeBuffer();
  return buf;
}

// Genera un PDF a partir del Excel llenado
async function generarPDFPorInventarioObra(r) {
  const xlsxBuf = await generarExcelPorInventarioObra(r);
  const sofficePath = process.env.LIBREOFFICE_PATH || "/Applications/LibreOffice.app/Contents/MacOS/soffice";
  if (!fs.existsSync(sofficePath)) {
    throw new Error('LibreOffice (soffice) no está instalado en el entorno. No es posible generar PDF con layout.');
  }
  const pdfBuf = await new Promise((resolve, reject) => {
    libre.convert(xlsxBuf, '.pdf', undefined, (err, done) => {
      if (err) return reject(err);
      resolve(done);
    });
  });
  return pdfBuf;
}

// POST /descargar -> genera XLSX o ZIP de PDFs
router.post('/descargar', async (req, res) => {
  try {
    const pool = global.db;
    const { nombre, cedula, obra, constructora, fecha_inicio, fecha_fin, formato = 'excel', limit = 10000 } = req.body || {};
    const startDate = formatDateOnly(fecha_inicio);
    const endDate = formatDateOnly(fecha_fin) || todayDateString();

    console.log(`[DESCARGAR] Formato solicitado: ${formato}`);

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
    const rows = (q.rows || []);

    console.log(`[DESCARGAR] Registros encontrados: ${rows.length}`);

    if (formato === 'excel') {
      if (!rows.length) {
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Inventario Obra');
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename="inventarios_obra.xlsx"');
        await workbook.xlsx.write(res);
        return res.end();
      }
      
      if (rows.length === 1) {
        console.log(`[DESCARGAR] Generando Excel para registro ID: ${rows[0].id}`);
        const xlsxBuf = await generarExcelPorInventarioObra(rows[0]);
        
        console.log(`[DESCARGAR] Buffer generado, tamaño: ${xlsxBuf.length} bytes`);
        
        // NO usar res.setHeader después de comenzar a escribir
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="inventario_obra_${rows[0].id}.xlsx"`,
          'Content-Length': xlsxBuf.length
        });
        
        res.write(xlsxBuf);
        res.end();
        
        console.log(`[DESCARGAR] Archivo enviado exitosamente`);
        return;
      }
      
      // Varios registros: ZIP con un Excel por registro
      console.log(`[DESCARGAR] Generando ZIP con ${rows.length} archivos Excel`);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="inventarios_obra_excels.zip"'
      });
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { 
        console.error('Archiver error:', err); 
        try{ 
          if (!res.headersSent) res.status(500).end(); 
        } catch(e){} 
      });
      archive.pipe(res);
      
      for (const r of rows) {
        try {
          const xlsxBuf = await generarExcelPorInventarioObra(r);
          archive.append(xlsxBuf, { name: `inventario_obra_${r.id}.xlsx` });
        } catch (err) {
          console.error(`Error generando Excel para id=${r.id}:`, err);
          archive.append(`Error generando Excel para id=${r.id}: ${err.message||err}`, { name: `inventario_obra_${r.id}_error.txt` });
        }
      }
      
      await archive.finalize();
      console.log(`[DESCARGAR] ZIP generado y enviado exitosamente`);
      return;
    }

    if (formato === 'pdf') {
      if (!rows.length) return res.status(404).json({ success: false, error: 'No se encontraron registros' });
      
      if (rows.length === 1) {
        console.log(`[DESCARGAR] Generando PDF para registro ID: ${rows[0].id}`);
        const pdfBuf = await generarPDFPorInventarioObra(rows[0]);
        
        console.log(`[DESCARGAR] PDF generado, tamaño: ${pdfBuf.length} bytes`);
        
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="inventario_obra_${rows[0].id}.pdf"`,
          'Content-Length': pdfBuf.length
        });
        
        res.write(pdfBuf);
        res.end();
        
        console.log(`[DESCARGAR] PDF enviado exitosamente`);
        return;
      }
      
      // Varios registros: ZIP con un PDF por registro
      console.log(`[DESCARGAR] Generando ZIP con ${rows.length} archivos PDF`);
      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="inventarios_obra_pdfs.zip"'
      });
      
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { 
        console.error('Archiver error:', err); 
        try{ 
          if (!res.headersSent) res.status(500).end(); 
        } catch(e){} 
      });
      archive.pipe(res);
      
      for (const r of rows) {
        try {
          const pdfBuf = await generarPDFPorInventarioObra(r);
          archive.append(pdfBuf, { name: `inventario_obra_${r.id}.pdf` });
        } catch (err) {
          console.error(`Error generando PDF para id=${r.id}:`, err);
          archive.append(`Error generando PDF para id=${r.id}: ${err.message||err}`, { name: `inventario_obra_${r.id}_error.txt` });
        }
      }
      
      await archive.finalize();
      console.log(`[DESCARGAR] ZIP de PDFs generado y enviado exitosamente`);
      return;
    }

    // fallback CSV
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    const header = keys.length ? keys : ['id','fecha','operador','obra','cliente'];
    const lines = [header.join(',')];
    for (const r of rows) {
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
    if (!res.headersSent) {
      res.status(500).json({ success:false, error: err.message });
    }
  }
});

export default router;