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

/**
 * Construye una cláusula WHERE parametrizada y un array de valores a partir de los filtros del body.
 * Usa hoy como `fecha_fin` cuando `fecha_inicio` se proporciona sin fecha de fin.
 * @param {object} body - Body de la solicitud con campos opcionales: nombre, obra, constructora, bomba_numero, fecha_inicio, fecha_fin.
 * @returns {{ where: string, values: Array, idx: number }}
 */
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

/**
 * POST /buscar
 * Busca registros de herramientas de mantenimiento usando filtros del body. Retorna una estructura
 * normalizada junto con una propiedad `raw` que contiene la fila completa de la BD.
 * @body {{ nombre?: string, obra?: string, constructora?: string, bomba_numero?: string, fecha_inicio?: string, fecha_fin?: string, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array<{ fecha: string, nombre: string, obra: string, constructora: string, bomba: string, raw: object }> }}
 */
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

/**
 * Genera un buffer PDF para un registro de herramientas de mantenimiento llenando una plantilla XLSX
 * y convirtiéndola mediante LibreOffice. Busca rutas candidatas de plantilla en orden.
 * @param {object} r - Fila de la BD de herramientas_mantenimiento.
 * @returns {Promise<Buffer>}
 * @throws {Error} Cuando no se encuentra el archivo de plantilla o LibreOffice no está instalado.
 */
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

/**
 * Construye un mapa del nombre de obra al nombre de sede (departamento) uniendo obras con departamentos.
 * Retorna un objeto vacío silenciosamente si la consulta falla.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, string>>}
 */
async function buildSedeMap(pool) {
  const sedeMap = {};
  try {
    const q = await pool.query(
      `SELECT o.nombre_obra, dep.nombre AS sede
       FROM obras o
       LEFT JOIN departamentos dep ON dep.id = o.departamento_id`
    );
    for (const row of q.rows) {
      if (row.nombre_obra) sedeMap[row.nombre_obra] = row.sede || '';
    }
  } catch (_) {}
  return sedeMap;
}

/**
 * POST /descargar
 * Exporta registros filtrados de herramientas de mantenimiento en el formato solicitado.
 * - `excel`: XLSX con tabla estilizada y columna `sede` derivada de obras.
 * - `pdf`: archivo ZIP con un PDF por registro (generado mediante plantilla LibreOffice).
 * - Cualquier otro valor: responde 400.
 * @body {{ nombre?: string, obra?: string, constructora?: string, bomba_numero?: string, fecha_inicio?: string, fecha_fin?: string, formato?: 'excel'|'pdf', limit?: number }}
 * @returns {Buffer} Adjunto en el formato solicitado.
 */
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
      const sedeMap = await buildSedeMap(pool);
      const rowsConSede = q.rows.map(r => ({ ...r, sede: sedeMap[r.nombre_proyecto] || '' }));
      const keys = Object.keys(rowsConSede[0]);
      ws.addTable({
        name: 'TablaHerramientas',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: keys.map(k => ({ name: k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), filterButton: true })),
        rows: rowsConSede.map(r => keys.map(k => {
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
