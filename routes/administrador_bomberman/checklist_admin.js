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

// GET /checklist/search -> búsqueda por query params (opcional)
router.get('/checklist/search', async (req, res) => {
  try {
    const pool = global.db;
    if (req.query && req.query.fecha_from && !req.query.fecha_to) req.query.fecha_to = todayDateString();
    const allowed = ['nombre_cliente','nombre_proyecto','fecha','fecha_from','fecha_to','nombre_operador','bomba_numero'];
    const { where, values } = buildWhere(req.query, allowed);
    const limit = Math.min(200, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    // Cambia lista_chequeo por checklist
    const finalQuery = `SELECT * FROM checklist ${where} ORDER BY id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    const q = await pool.query(finalQuery, [...values, limit, offset]);
    res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error('Error searching checklist:', err);
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
      clauses.push(`(nombre_operador ILIKE $${idx})`);
      values.push(`%${nombre}%`); idx++;
    }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (startDate) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(startDate); }
    if (endDate) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(endDate); }

    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    // Cambia lista_chequeo por checklist
    const q = await pool.query(
      `SELECT * FROM checklist ${where} ORDER BY id DESC LIMIT $${idx} OFFSET $${idx+1}`,
      [...values, Math.min(1000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    // Solo mostrar registros que tengan al menos un campo REGULAR/MALO
    function filtraChecklist(row) {
      const resultado = {};
      let tieneRegularMalo = false;
      Object.entries(row).forEach(([k, v]) => {
        if (
          typeof v === "string" &&
          ["REGULAR", "MALO"].includes(v.toUpperCase())
        ) {
          resultado[k] = v;
          tieneRegularMalo = true;
          // incluir observación si existe
          const obsKey = k + "_observacion";
          if (row[obsKey]) resultado[obsKey] = row[obsKey];
        }
        // incluir campos básicos para mostrar en la lista
        if (
          [
            "id",
            "fecha_servicio",
            "nombre_operador",
            "bomba_numero",
            "nombre_proyecto",
            "nombre_cliente"
          ].includes(k)
        ) {
          resultado[k] = v;
        }
      });
      return tieneRegularMalo ? resultado : null;
    }

    const rows = q.rows
      .map(filtraChecklist)
      .filter(r => r !== null)
      .map(r => ({
        fecha: formatDateOnly(r.fecha_servicio),
        nombre: r.nombre_operador || '',
        cedula: r.numero_identificacion || null,
        empresa: r.bomba_numero || '',
        obra: r.nombre_proyecto || '',
        constructora: r.nombre_cliente || '',
        raw: r
      }));

    res.json({ success: true, count: rows.length, rows });
  } catch (err) {
    console.error('Error en /checklist_admin/buscar:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// genera PDF de una inspección usando SOLO el template, si no existe lanza error
async function generarPDFPorChecklist(r) {
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'templates', 'checklist_admin_template.xlsx'),
      path.join(process.cwd(), 'routes', 'templates', 'checklist_admin_template.xlsx'),
      path.join(process.cwd(), 'routes', 'administrador_bomberman', 'templates', 'checklist_admin_template.xlsx')
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

    const xlsxBuf = await workbook.xlsx.writeBuffer();

    process.env.LIBREOFFICE_PATH = process.env.LIBREOFFICE_PATH || "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    // Antes de llamar a libre.convert, verifica si el binario existe
    const sofficePath = process.env.LIBREOFFICE_PATH || "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    if (!fs.existsSync(sofficePath)) {
      throw new Error('LibreOffice (soffice) no está instalado en el entorno. No es posible generar PDF con layout en Render.');
    }
    const pdfBuf = await new Promise((resolve, reject) => {
      libre.convert(xlsxBuf, '.pdf', undefined, (err, done) => {
        if (err) return reject(err);
        resolve(done);
      });
    });

    return pdfBuf;
  } catch (err) {
    console.error('Error en generarPDFPorChecklist:', err);
    throw err;
  }
}

// POST /descargar -> genera XLSX o ZIP de PDFs
// Acepta tanto /descargar como /checklist_admin/descargar para compatibilidad con el front
router.post(['/descargar', '/checklist_admin/descargar'], async (req, res) => {
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
    const q = await pool.query(`SELECT * FROM checklist ${where} ORDER BY id DESC LIMIT $${idx}`, [...values, Math.min(50000, parseInt(limit) || 10000)]);

    // Solo mostrar registros que tengan al menos un campo REGULAR/MALO
    function filtraChecklist(row) {
      const resultado = {};
      let tieneRegularMalo = false;
      Object.entries(row).forEach(([k, v]) => {
        if (
          typeof v === "string" &&
          ["REGULAR", "MALO"].includes(v.toUpperCase())
        ) {
          resultado[k] = v;
          tieneRegularMalo = true;
          const obsKey = k + "_observacion";
          if (row[obsKey]) resultado[obsKey] = row[obsKey];
        }
        if (
          [
            "id",
            "fecha_servicio",
            "nombre_operador",
            "bomba_numero",
            "nombre_proyecto",
            "nombre_cliente"
          ].includes(k)
        ) {
          resultado[k] = v;
        }
      });
      return tieneRegularMalo ? resultado : null;
    }

    const filtrados = q.rows.map(filtraChecklist).filter(r => r !== null);

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Checklist');
      if (!q.rows.length) {
        res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition','attachment; filename=checklist.xlsx');
        await workbook.xlsx.write(res);
        return res.end();
      }

      // Campos de identificación: siempre visibles
      const camposBasicos = new Set(['id', 'empresa_id', 'signio_transaccion_id', 'fecha_servicio',
        'nombre_cliente', 'nombre_proyecto', 'nombre_operador', 'bomba_numero', 'horometro_motor', 'observaciones']);

      // Campos de texto libre / numéricos / fechas: siempre mostrar su valor
      const noSeleccion = new Set([
        'radio_marca_serial_estado', 'arnes_marca_serial_fecha_estado', 'eslinga_marca_serial_fecha_estado',
        'combustible_pimpinas', 'ultima_fecha_lavado_tanque', 'dias_grasa', 'punto_engrase_tapado',
        'ultima_fecha_mantenimiento_salida', 'mangueras_3_pulgadas', 'mangueras_4_pulgadas', 'mangueras_5_pulgadas',
        'mangueras_sin_acoples', 'numero_piso_fundiendo', 'cantidad_puntos_anclaje', 'ultima_fecha_medicion_espesores'
      ]);

      // Valores "buenos" que se omiten en campos de selección
      const valoresBueno = new Set(['BUENO', 'SI', 'LIMPIO', 'REALIZADO', 'NORMAL', 'NO FALTAN', 'CUMPLE CON LAS CONDICIONES']);

      const allKeys = Object.keys(q.rows[0]);

      // Procesar filas: blanquear campos selección con valor "bueno/si"
      const processedRows = q.rows.map(row => {
        const result = {};
        allKeys.forEach(k => {
          let val = row[k];
          if (k === 'fecha_servicio') {
            result[k] = val ? formatDateOnly(val) : '';
            return;
          }
          if (val === null || val === undefined) { result[k] = ''; return; }

          const esBasico = camposBasicos.has(k);
          const esObservacion = k.endsWith('_observacion');
          const esGalones = k.endsWith('_galones');
          const esNoSeleccion = noSeleccion.has(k);

          if (esBasico || esNoSeleccion || esGalones) {
            result[k] = typeof val === 'object' ? JSON.stringify(val) : String(val);
            return;
          }
          if (esObservacion) {
            result[k] = val ? String(val) : '';
            return;
          }
          // Campo de selección: mostrar solo si NO es "bueno/si"
          const valUpper = String(val).trim().toUpperCase();
          result[k] = valoresBueno.has(valUpper) ? '' : String(val);
        });
        return result;
      });

      // Incluir solo columnas que tengan al menos un valor no vacío (excepto básicos que van siempre)
      const keysToInclude = allKeys.filter(k =>
        camposBasicos.has(k) || processedRows.some(r => r[k] !== '' && r[k] != null)
      );

      ws.addTable({
        name: 'ChecklistTable',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleMedium2', showRowStripes: true },
        columns: keysToInclude.map(k => ({
          name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          filterButton: true
        })),
        rows: processedRows.map(r => keysToInclude.map(k => r[k] ?? ''))
      });
      keysToInclude.forEach((k, i) => {
        const col = ws.getColumn(i + 1);
        const maxLen = Math.max(
          k.replace(/_/g, ' ').length,
          ...processedRows.map(r => String(r[k] ?? '').length)
        );
        col.width = Math.min(60, Math.max(12, maxLen + 2));
      });
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=checklist.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!filtrados || filtrados.length === 0) return res.status(404).json({ success: false, error: 'No se encontraron registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="checklist.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { console.error('Archiver error:', err); try{ res.status(500).end(); } catch(e){} });
      archive.pipe(res);
      for (const r of filtrados) {
        try {
          // SOLO usar generarPDFPorChecklist (que usa libreoffice y el template)
          const pdfBuf = await generarPDFPorChecklist(r);
          archive.append(pdfBuf, { name: `checklist_${r.id}.pdf` });
        } catch (pdfErr) {
          archive.append(`Error generando PDF para id=${r.id}: ${pdfErr.message||pdfErr}`, { name: `checklist_${r.id}_error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    // fallback CSV
    const keys = filtrados[0] ? Object.keys(filtrados[0]) : [];
    const header = keys.length ? keys : ['id','fecha','operador','obra','cliente'];
    const lines = [header.join(',')];
    for (const r of filtrados) {
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
    res.setHeader('Content-Disposition','attachment; filename="checklist.csv"');
    return res.send(csv);

  } catch (err) {
    console.error('Error en /checklist_admin/descargar:', err);
    res.status(500).json({ success:false, error: err.message });
  }
});

export { generarPDFPorChecklist };
export default router;
