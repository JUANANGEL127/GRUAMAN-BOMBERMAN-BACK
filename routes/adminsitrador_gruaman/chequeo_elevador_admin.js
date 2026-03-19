import express from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';
import { buildWhere } from '../../helpers/queryBuilder.js';
const router = express.Router();

/**
 * GET /adminsitrador_gruaman/chequeo_elevador/search
 * Búsqueda flexible por query string en registros de inspección de elevador de personal.
 * Asigna automáticamente `fecha_to` a hoy cuando `fecha_from` se proporciona sin fecha de fin.
 * @query {{ nombre_cliente?, nombre_proyecto?, fecha?, fecha_from?, fecha_to?, nombre_operador?, cargo?, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array }}
 */
router.get('/chequeo_elevador/search', async (req, res) => {
  try {
    const pool = global.db;
    if (req.query && req.query.fecha_from && !req.query.fecha_to) req.query.fecha_to = todayDateString();
    const allowed = ['nombre_cliente','nombre_proyecto','fecha','fecha_from','fecha_to','nombre_operador','cargo'];
    const { where, values } = buildWhere(req.query, allowed);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    const finalQuery = `SELECT * FROM chequeo_elevador ${where} ORDER BY id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    const q = await pool.query(finalQuery, [...values, limit, offset]);
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error searching chequeo_elevador:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /adminsitrador_gruaman/buscar
 * Busca registros de inspección de elevador de personal usando filtros del body.
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
      `SELECT * FROM chequeo_elevador ${where} ORDER BY id DESC LIMIT $${idx} OFFSET $${idx+1}`,
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
    console.error('Error en /chequeo_elevador_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Genera un PDF de registro único para una inspección de elevador de personal.
 * @param {object} r - Fila de BD de chequeo_elevador.
 * @returns {Promise<Buffer>}
 */
async function generarPDFPorChequeoElevador(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(16).text(`Chequeo Elevador - ID: ${r.id}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? formatDateOnly(r.fecha_servicio) : ''}`);
      doc.text(`Cliente: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Cargo: ${r.cargo || ''}`);
      doc.moveDown();
      const campos = [
        'epp_completo_y_en_buen_estado','epcc_completo_y_en_buen_estado','estructura_equipo_buen_estado',
        'equipo_sin_fugas_fluido','tablero_mando_buen_estado','puerta_acceso_buen_estado',
        'gancho_seguridad_funciona_correctamente','plataforma_limpia_y_sin_sustancias_deslizantes',
        'cabina_libre_de_escombros_y_aseada','cables_electricos_y_motor_buen_estado',
        'anclajes_y_arriostramientos_bien_asegurados','secciones_equipo_bien_acopladas',
        'rodillos_guia_buen_estado_y_lubricados','rieles_seguridad_techo_buen_estado',
        'plataforma_trabajo_techo_buen_estado','escalera_acceso_techo_buen_estado',
        'freno_electromagnetico_buen_estado','sistema_velocidad_calibrado_y_engranes_buen_estado',
        'limitantes_superior_inferior_calibrados','area_equipo_senalizada_y_demarcada',
        'equipo_con_parada_emergencia','placa_identificacion_con_carga_maxima',
        'sistema_sobrecarga_funcional','cabina_desinfectada_previamente','observaciones_generales'
      ];
      campos.forEach(k => {
        if (r[k] !== undefined && r[k] !== null && String(r[k]).trim() !== '') {
          doc.fontSize(11).text(`${k.replace(/_/g,' ')}: ${r[k]}`);
        }
      });
      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
 * POST /adminsitrador_gruaman/descargar
 * Exporta registros filtrados de inspección de elevador de personal en el formato solicitado.
 * - `excel`: XLSX con todas las columnas en una tabla estilizada.
 * - `pdf`: archivo ZIP con un PDF por registro.
 * - Por defecto: CSV con las columnas identificadoras principales.
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
    const q = await pool.query(`SELECT * FROM chequeo_elevador ${where} ORDER BY id DESC LIMIT $${idx}`, [...values, Math.min(50000, parseInt(limit) || 10000)]);

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Chequeo Elevador');

      if (!q.rows || q.rows.length === 0) {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=chequeo_elevador.xlsx');
        await workbook.xlsx.write(res);
        return res.end();
      }

      const keys = Object.keys(q.rows[0]);
      ws.addTable({
        name: 'TablaChequeoElevador',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: keys.map(k => ({ name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), filterButton: true })),
        rows: q.rows.map(r => keys.map(k => {
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
      res.setHeader('Content-Disposition','attachment; filename=chequeo_elevador.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!q.rows || q.rows.length === 0) return res.status(404).json({ success: false, error: 'No se encontraron registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="chequeo_elevador.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { console.error('Archiver error:', err); try{ res.status(500).end(); } catch(e){} });
      archive.pipe(res);
      for (const r of q.rows) {
        try {
          const pdfBuf = await generarPDFPorChequeoElevador(r);
          archive.append(pdfBuf, { name: `chequeo_elevador_${r.id}.pdf` });
        } catch (pdfErr) {
          archive.append(`Error generando PDF para id=${r.id}: ${pdfErr.message||pdfErr}`, { name: `chequeo_elevador_${r.id}_error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    // CSV fallback
    const header = ['id','fecha','operador','obra','cliente'];
    const lines = [header.join(',')];
    for (const r of q.rows) {
      const fecha = r.fecha_servicio ? formatDateOnly(r.fecha_servicio) : '';
      const nombreOp = (r.nombre_operador||'').replace(/"/g,'""');
      const obraVal = (r.nombre_proyecto||'').replace(/"/g,'""');
      const cliente = (r.nombre_cliente||'').replace(/"/g,'""');
      lines.push([r.id, `"${fecha}"`, `"${nombreOp}"`, `"${obraVal}"`, `"${cliente}"`].join(','));
    }
    const csv = lines.join('\r\n');
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="chequeo_elevador.csv"');
    return res.send(csv);

  } catch (err) {
    console.error('Error en /chequeo_elevador_admin/descargar:', err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export default router;
