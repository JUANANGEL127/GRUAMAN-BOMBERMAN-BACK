import express from 'express';
import ExcelJS from 'exceljs';
import archiver from 'archiver';
import fs from 'fs';
import path from 'path';
import libre from 'libreoffice-convert';
import { formatDateOnly, todayDateString } from '../../helpers/dateUtils.js';
const router = express.Router();

const TABLE = 'herramientas_mantenimiento';
const ITEMS = [
  'copa_bristol_10mm','extension_media_x12_a','palanca_media_x15','llave_bristol_14',
  'llave_11','llave_12','llave_13','llave_14','llave_19',
  'destornillador_pala','destornillador_estrella','copa_punta_10_media',
  'extension_media_x12_b','rachet_media','llave_mixta_17','llave_expansiva_15'
];

function buildClauses(body) {
  const { nombre, obra, constructora, bomba_numero, fecha_inicio, fecha_fin } = body || {};
  const clauses = [], values = [];
  let idx = 1;
  if (nombre)       { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
  if (obra)         { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
  if (constructora) { clauses.push(`nombre_cliente  ILIKE $${idx++}`); values.push(`%${constructora}%`); }
  if (bomba_numero) { clauses.push(`bomba_numero    ILIKE $${idx++}`); values.push(`%${bomba_numero}%`); }
  const sd = formatDateOnly(fecha_inicio);
  const ed = formatDateOnly(fecha_fin) || todayDateString();
  if (sd) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(sd); }
  if (ed) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(ed); }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', values, idx };
}

// POST /buscar
router.post('/buscar', async (req, res) => {
  try {
    const pool = global.db;
    const { limit = 50, offset = 0 } = req.body || {};
    const { where, values, idx } = buildClauses(req.body);
    const q = await pool.query(
      `SELECT * FROM ${TABLE} ${where} ORDER BY id DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, Math.min(1000, parseInt(limit)||50), parseInt(offset)||0]
    );
    const countQ = await pool.query(`SELECT COUNT(*) FROM ${TABLE} ${where}`, values);
    const rows = q.rows.map(r => ({
      fecha: formatDateOnly(r.fecha_servicio),
      nombre: r.nombre_operador || '',
      obra: r.nombre_proyecto || '',
      constructora: r.nombre_cliente || '',
      bomba: r.bomba_numero || '',
      raw: r
    }));
    res.json({ success: true, count: parseInt(countQ.rows[0].count), rows });
  } catch (err) {
    console.error('Error en herramientas_mantenimiento_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// genera PDF de un registro usando template XLSX + LibreOffice
async function generarPDF(r) {
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'templates', 'herramientas_mantenimiento_template.xlsx'),
      path.join(process.cwd(), 'routes', 'templates', 'herramientas_mantenimiento_template.xlsx'),
      path.join(process.cwd(), 'routes', 'administrador_bomberman', 'templates', 'herramientas_mantenimiento_template.xlsx')
    ];
    const tplPath = candidatePaths.find(p => fs.existsSync(p));
    if (!tplPath) throw new Error('Template XLSX no encontrado. Agrega herramientas_mantenimiento_template.xlsx en la carpeta templates.');

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

    const xlsxBuf = await workbook.xlsx.writeBuffer();

    const sofficePath = process.env.LIBREOFFICE_PATH || '/Applications/LibreOffice.app/Contents/MacOS/soffice';
    if (!fs.existsSync(sofficePath)) {
      throw new Error('LibreOffice (soffice) no está instalado en el entorno.');
    }
    process.env.LIBREOFFICE_PATH = sofficePath;

    const pdfBuf = await new Promise((resolve, reject) => {
      libre.convert(xlsxBuf, '.pdf', undefined, (err, done) => {
        if (err) return reject(err);
        resolve(done);
      });
    });

    return pdfBuf;
  } catch (err) {
    console.error('Error en generarPDF herramientas_mantenimiento:', err);
    throw err;
  }
}

// POST /descargar
router.post('/descargar', async (req, res) => {
  try {
    const pool = global.db;
    const { formato = 'excel' } = req.body || {};
    const { where, values, idx } = buildClauses(req.body);
    const q = await pool.query(
      `SELECT * FROM ${TABLE} ${where} ORDER BY id DESC LIMIT $${idx}`,
      [...values, 50000]
    );

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Herramientas Mantenimiento');
      if (!q.rows.length) {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=herramientas_mantenimiento.xlsx');
        await workbook.xlsx.write(res);
        return res.end();
      }
      const keys = Object.keys(q.rows[0]);
      ws.addTable({
        name: 'TablaHerramientas',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: keys.map(k => ({ name: k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), filterButton: true })),
        rows: q.rows.map(r => keys.map(k => {
          if (k === 'fecha_servicio') return r[k] ? formatDateOnly(r[k]) : '';
          if (r[k] === null || r[k] === undefined) return '';
          return r[k];
        }))
      });
      keys.forEach((k, i) => { ws.getColumn(i+1).width = Math.min(40, Math.max(12, k.length + 2)); });
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=herramientas_mantenimiento.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!q.rows.length) return res.status(404).json({ success:false, error:'Sin registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="herramientas_mantenimiento.zip"');
      const archive = archiver('zip', { zlib:{ level:9 } });
      archive.on('error', err => { try{ res.status(500).end(); }catch(e){} });
      archive.pipe(res);
      for (const r of q.rows) {
        try {
          const buf = await generarPDF(r);
          archive.append(buf, { name: `herramientas_${r.id}.pdf` });
        } catch(e) {
          archive.append(`Error id=${r.id}: ${e.message}`, { name: `herramientas_${r.id}_error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    res.status(400).json({ success:false, error:'Formato no soportado' });
  } catch (err) {
    console.error('Error en herramientas_mantenimiento_admin/descargar:', err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export default router;
