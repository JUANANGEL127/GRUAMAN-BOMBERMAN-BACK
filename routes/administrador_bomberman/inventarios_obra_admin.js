import express from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import libre from 'libreoffice-convert';
import dotenv from 'dotenv';
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';
import { buildWhere } from '../../helpers/queryBuilder.js';
dotenv.config();
const router = express.Router();

/**
 * GET /inventarios_obra/search
 * Búsqueda flexible por query string en registros de inventario de obra.
 * Asigna automáticamente `fecha_to` a hoy cuando `fecha_from` se proporciona sin fecha de fin.
 * @query {{ nombre_cliente?, nombre_proyecto?, fecha?, fecha_from?, fecha_to?, nombre_operador?, cargo?, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array }}
 */
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

/**
 * POST /buscar
 * Busca registros de inventario de obra usando filtros del body.
 * Retorna una estructura normalizada con una propiedad `raw` que contiene la fila original de la BD.
 * @body {{ nombre?: string, cedula?: string, obra?: string, constructora?: string, fecha_inicio?: string, fecha_fin?: string, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array<{ fecha: string, nombre: string, cedula: string|null, empresa: string, obra: string, constructora: string, raw: object }> }}
 */
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
      fecha: formatDateOnly(r.fecha_servicio),
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

/**
 * Llena una plantilla XLSX con datos de un único registro de inventario_obra.
 * Reemplaza los marcadores `{{campo}}` en todas las celdas (texto plano y richText).
 * @param {object} r - Fila de BD de inventario_obra.
 * @returns {Promise<Buffer>} Buffer XLSX relleno.
 * @throws {Error} Cuando no se encuentra el archivo de plantilla en ninguna ruta candidata.
 */
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
    if (k === 'fecha_servicio') v = v ? formatDateOnly(v) : '';
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

/**
 * Genera un buffer PDF a partir de la plantilla XLSX rellena convirtiéndola mediante LibreOffice.
 * @param {object} r - Fila de BD de inventario_obra.
 * @returns {Promise<Buffer>}
 * @throws {Error} Cuando LibreOffice no está instalado en la ruta resuelta.
 */
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

/**
 * POST /descargar
 * Exporta registros filtrados de inventario de obra en el formato solicitado.
 * - `excel`: un único XLSX cuando hay un solo resultado; ZIP de archivos XLSX por registro para múltiples.
 * - `pdf`: un único PDF cuando hay un solo resultado; ZIP de PDFs por registro para múltiples.
 * - Por defecto: CSV con todas las columnas.
 * @body {{ nombre?: string, cedula?: string, obra?: string, constructora?: string, fecha_inicio?: string, fecha_fin?: string, formato?: 'excel'|'pdf'|'csv', limit?: number }}
 * @returns {Buffer} Adjunto en el formato solicitado.
 */
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
    const rows = (q.rows || []);

    if (formato === 'excel') {
      if (!rows.length) {
        const workbook = new ExcelJS.Workbook();
        workbook.addWorksheet('Inventario Obra');
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename="inventarios_obra.xlsx"');
        await workbook.xlsx.write(res);
        return res.end();
      }

      if (rows.length === 1) {
        const xlsxBuf = await generarExcelPorInventarioObra(rows[0]);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="inventario_obra_${rows[0].id}.xlsx"`,
          'Content-Length': xlsxBuf.length
        });
        res.write(xlsxBuf);
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="inventarios_obra_excels.zip"'
      });
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => {
        console.error('Archiver error:', err);
        try{ if (!res.headersSent) res.status(500).end(); } catch(e){}
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
      return;
    }

    if (formato === 'pdf') {
      if (!rows.length) return res.status(404).json({ success: false, error: 'No se encontraron registros' });

      if (rows.length === 1) {
        const pdfBuf = await generarPDFPorInventarioObra(rows[0]);
        res.writeHead(200, {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="inventario_obra_${rows[0].id}.pdf"`,
          'Content-Length': pdfBuf.length
        });
        res.write(pdfBuf);
        res.end();
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Disposition': 'attachment; filename="inventarios_obra_pdfs.zip"'
      });
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => {
        console.error('Archiver error:', err);
        try{ if (!res.headersSent) res.status(500).end(); } catch(e){}
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
      return;
    }

    // CSV fallback
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    const header = keys.length ? keys : ['id','fecha','operador','obra','cliente'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const rowArr = header.map(k => {
        let val = r[k];
        if (k === 'fecha_servicio') {
          try { val = val ? formatDateOnly(val) : ''; } catch (e) { val = val ? String(val) : ''; }
        } else if (val === null || val === undefined) {
          val = '';
        } else if (val instanceof Date) {
          try { val = formatDateOnly(val) || ''; } catch (e) { val = ''; }
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
