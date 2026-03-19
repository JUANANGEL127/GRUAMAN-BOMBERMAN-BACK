import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';
import { buildWhere } from '../../helpers/queryBuilder.js';
const router = express.Router();

/**
 * GET /inspeccion_epcc_bomberman/search
 * Búsqueda flexible por query string en registros de inspección EPCC Bomberman.
 * Asigna automáticamente `fecha_to` a hoy cuando `fecha_from` se proporciona sin fecha de fin.
 * @query {{ nombre_cliente?, nombre_proyecto?, fecha?, fecha_from?, fecha_to?, nombre_operador?, cargo?, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array }}
 */
router.get('/inspeccion_epcc_bomberman/search', async (req, res) => {
  try {
    const pool = global.db;
    if (req.query && req.query.fecha_from && !req.query.fecha_to) req.query.fecha_to = todayDateString();
    const allowed = ['nombre_cliente','nombre_proyecto','fecha','fecha_from','fecha_to','nombre_operador','cargo'];
    const { where, values } = buildWhere(req.query, allowed);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    const finalQuery = `SELECT * FROM inspeccion_epcc_bomberman ${where} ORDER BY id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    const q = await pool.query(finalQuery, [...values, limit, offset]);
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error searching inspeccion_epcc_bomberman:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /buscar
 * Busca registros de inspección EPCC Bomberman usando filtros del body.
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
      clauses.push(`(nombre_operador ILIKE $${idx})`);
      values.push(`%${nombre}%`); idx++;
    }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const q = await pool.query(
      `SELECT * FROM inspeccion_epcc_bomberman ${where} ORDER BY id DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, Math.min(1000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    const rows = q.rows.map(r => ({
      fecha: formatDateOnly(r.fecha_servicio),
      nombre: r.nombre_operador || '',
      cedula: r.numero_identificacion || null,
      empresa: r.cargo || '',
      obra: r.nombre_proyecto || '',
      constructora: r.nombre_cliente || '',
      raw: r
    }));

    res.json({ success: true, count: q.rowCount, rows });
  } catch (err) {
    console.error('Error en /inspeccion_epcc_bomberman_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Genera un PDF de registro único para una inspección EPCC de bomberman.
 * Renderiza dinámicamente todos los campos no pertenecientes al encabezado de la fila de BD.
 * @param {object} r - Fila de BD de inspeccion_epcc_bomberman.
 * @returns {Promise<Buffer>}
 */
async function generarPDFPorInspeccionEPCCBomberman(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(16).text(`Inspección EPCC Bomberman - ID: ${r.id}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? formatDateOnly(r.fecha_servicio) : ''}`);
      doc.text(`Cliente: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Cargo: ${r.cargo || ''}`);
      doc.moveDown();
      Object.entries(r).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v).trim() !== '' && !['id','fecha_servicio','nombre_cliente','nombre_proyecto','nombre_operador','cargo'].includes(k)) {
          doc.fontSize(11).text(`${k.replace(/_/g,' ')}: ${v}`);
        }
      });
      doc.end();
    } catch (err) { reject(err); }
  });
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
 * Exporta registros filtrados de inspección EPCC bomberman en el formato solicitado.
 * - `excel`: XLSX con tabla estilizada, deduplicada por id, con columna `sede`.
 * - `pdf`: archivo ZIP con un PDF por registro.
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
    if (nombre) { clauses.push(`(nombre_operador ILIKE $${idx})`); values.push(`%${nombre}%`); idx++; }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const q = await pool.query(`SELECT * FROM inspeccion_epcc_bomberman ${where} ORDER BY id DESC LIMIT $${idx}`, [...values, Math.min(50000, parseInt(limit) || 10000)]);

    if (formato === 'excel') {
      const seen = new Set();
      const rowsUnicos = (q.rows || []).filter(r => {
        const id = r?.id;
        if (id != null && seen.has(id)) return false;
        if (id != null) seen.add(id);
        return true;
      });

      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Inspección EPCC Bomberman');

      if (!rowsUnicos.length) {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=inspeccion_epcc.xlsx');
        await workbook.xlsx.write(res);
        return res.end();
      }

      const sedeMap = await buildSedeMap(pool);
      const rowsConSede = rowsUnicos.map(r => ({ ...r, sede: sedeMap[r.nombre_proyecto] || '' }));
      const keys = Object.keys(rowsConSede[0]);
      ws.addTable({
        name: 'TablaEPCCBomberman',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: keys.map(k => ({ name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), filterButton: true })),
        rows: rowsConSede.map(r => keys.map(k => {
          let val = r[k];
          if (k === 'fecha_servicio') return val ? formatDateOnly(val) : '';
          if (val === null || val === undefined) return '';
          if (typeof val === 'object') { try { return JSON.stringify(val); } catch(e) { return String(val); } }
          return val;
        }))
      });
      keys.forEach((k, i) => {
        ws.getColumn(i + 1).width = Math.min(60, Math.max(12, k.replace(/_/g, ' ').length + 4));
      });

      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=inspeccion_epcc.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!q.rows || q.rows.length === 0) return res.status(404).json({ success: false, error: 'No se encontraron registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="inspeccion_epcc.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { console.error('Archiver error:', err); try{ res.status(500).end(); } catch(e){} });
      archive.pipe(res);
      for (const r of q.rows) {
        try {
          const pdfBuf = await generarPDFPorInspeccionEPCCBomberman(r);
          archive.append(pdfBuf, { name: `inspeccion_epcc_${r.id}.pdf` });
        } catch (pdfErr) {
          archive.append(`Error generando PDF para id=${r.id}: ${pdfErr.message||pdfErr}`, { name: `inspeccion_epcc_${r.id}_error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    // CSV fallback
    const keys = q.rows[0] ? Object.keys(q.rows[0]) : [];
    const header = keys.length ? keys : ['id','fecha','operador','obra','cliente'];
    const lines = [header.join(',')];
    for (const r of q.rows) {
      const rowArr = header.map(k => {
        let val = r[k];
        if (k === 'fecha_servicio') {
          val = val ? formatDateOnly(val) : '';
        } else if (val === null || val === undefined) {
          val = '';
        } else if (typeof val === 'object') {
          try { val = JSON.stringify(val); } catch (e) { val = String(val); }
        }
        return `"${String(val).replace(/"/g,'""')}"`;
      });
      lines.push(rowArr.join(','));
    }
    const csv = lines.join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="inspeccion_epcc.csv"');
    return res.send(csv);

  } catch (err) {
    console.error('Error en /inspeccion_epcc_bomberman_admin/descargar:', err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export default router;
