import express from "express";
import { DateTime } from "luxon";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import archiver from "archiver";
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';
import { buildWhere } from '../../helpers/queryBuilder.js';
const router = express.Router();

/**
 * Festivos colombianos fijos (MM-DD), independientes del año.
 * @type {string[]}
 */
const FESTIVOS_FIJOS = [
  "01-01",
  "05-01",
  "07-20",
  "08-07",
  "12-08",
  "12-25",
];

/**
 * Festivos colombianos móviles por año (Ley Emiliani — trasladados al lunes siguiente).
 * @type {Record<string, string[]>}
 */
const FESTIVOS_MOVILES_POR_ANIO = {
  "2024": ["01-08","03-25","03-28","03-29","04-01","05-13","06-03","06-10","07-01","08-19","10-14","11-04","11-11"],
  "2025": ["01-06","03-24","04-17","04-18","05-01","06-02","06-23","06-30","08-18","10-13","11-03","11-17","12-08"],
  "2026": ["01-12","04-02","04-03","04-06","05-25","06-15","06-29","07-20","08-17","10-12","11-02","11-16","12-08"],
  "2027": ["01-11","03-22","04-01","04-02","05-17","06-07","06-14","07-05","08-16","10-18","11-01","11-15","12-08"],
};

/**
 * Retorna true si la fecha ISO dada es un festivo colombiano o un domingo.
 * @param {string} fechaISO - "YYYY-MM-DD"
 * @returns {boolean}
 */
function esFestivo(fechaISO) {
  const dt = DateTime.fromISO(fechaISO, { zone: "America/Bogota" });
  if (dt.weekday === 7) return true;
  const mesDia = dt.toFormat("MM-dd");
  const anio = dt.toFormat("yyyy");
  if (FESTIVOS_FIJOS.includes(mesDia)) return true;
  const moviles = FESTIVOS_MOVILES_POR_ANIO[anio] || [];
  return moviles.includes(mesDia);
}

/**
 * Calcula las horas trabajadas y el desglose de horas extras para un registro de jornada.
 * La jornada base es 7 h 20 min (440 minutos). Las horas más allá de la base se clasifican
 * por minuto como extra diurna (06:00–18:59), extra nocturna o extra festiva.
 * En festivos, todos los minutos se cuentan como extra festiva.
 * @param {{ hora_ingreso: string, hora_salida: string, minutos_almuerzo?: number, fecha: string }} params
 * @returns {{ dia_semana: string, festivo: boolean, horas_trabajadas: number, extra_diurna: number, extra_nocturna: number, extra_festiva: number, total_extras: number }|null}
 */
function calcularHoras({ hora_ingreso, hora_salida, minutos_almuerzo = 0, fecha }) {
  const zone = "America/Bogota";
  const hhIn = String(hora_ingreso || "").trim();
  const hhOut = String(hora_salida || "").trim();
  if (!hhIn || !hhOut) return null;

  const dtIngreso = DateTime.fromISO(`${fecha}T${hhIn}`, { zone });
  let dtSalida = DateTime.fromISO(`${fecha}T${hhOut}`, { zone });
  if (!dtIngreso.isValid || !dtSalida.isValid) return null;
  if (dtSalida < dtIngreso) dtSalida = dtSalida.plus({ days: 1 });

  let minutosTotales = Math.max(0, Math.round(dtSalida.diff(dtIngreso, "minutes").minutes) - (minutos_almuerzo || 0));
  const horasTrabajadas = +(minutosTotales / 60).toFixed(2);

  const jornadaBaseMin = 7 * 60 + 20;
  const festivo = esFestivo(fecha);

  let minutosExtraDiurna = 0;
  let minutosExtraNocturna = 0;
  let minutosExtraFestiva = 0;
  let minutosNormales = 0;

  if (festivo) {
    minutosExtraFestiva = minutosTotales;
  } else {
    let actual = dtIngreso;
    let resto = minutosTotales;
    let minutosBase = jornadaBaseMin;
    while (resto > 0) {
      const hour = actual.setZone(zone).hour;
      const isDiurna = hour >= 6 && hour < 19;
      if (minutosBase > 0) {
        minutosNormales++;
        minutosBase--;
      } else {
        if (isDiurna) minutosExtraDiurna++;
        else minutosExtraNocturna++;
      }
      actual = actual.plus({ minutes: 1 });
      resto--;
    }
  }

  const extra_diurna = +(minutosExtraDiurna / 60).toFixed(2);
  const extra_nocturna = +(minutosExtraNocturna / 60).toFixed(2);
  const extra_festiva = +(minutosExtraFestiva / 60).toFixed(2);
  const total_extras = +(extra_diurna + extra_nocturna + extra_festiva).toFixed(2);

  const diaSemana = DateTime.fromISO(fecha, { zone }).setLocale("es").toFormat("cccc");

  return {
    dia_semana: diaSemana,
    festivo,
    horas_trabajadas: +horasTrabajadas.toFixed(2),
    extra_diurna,
    extra_nocturna,
    extra_festiva,
    total_extras
  };
}

let db;

/**
 * Resuelve global.db en el momento de la llamada, lanzando error si aún no está inicializado.
 * @returns {import('pg').Pool}
 * @throws {Error} Si global.db no está disponible.
 */
function ensureDb() {
  if (!global.db) throw new Error("global.db no está definido. Importa este router después de inicializar la DB.");
  return global.db;
}

/**
 * Genera un buffer PDF de un solo registro para una entrada de jornada con los totales calculados.
 * @param {object} r - Registro de jornada incluyendo campos calculados (horas_trabajadas, extra_*, festivo, etc.)
 * @returns {Promise<Buffer>}
 */
async function generarPDFPorRegistro(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(16).text(`Horas Jornada - ${r.nombre_operador || ''}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? formatDateOnly(r.fecha_servicio) : ''}`);
      doc.text(`Cliente: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Cargo: ${r.cargo || ''}`);
      doc.text(`Empresa ID: ${r.empresa_id || ''}`);
      doc.text(`Hora ingreso: ${r.hora_ingreso || ''}`);
      doc.text(`Hora salida: ${r.hora_salida || ''}`);
      doc.text(`Minutos almuerzo: ${r.minutos_almuerzo || 0}`);
      doc.moveDown();
      if (r.dia_semana) doc.text(`Día semana: ${r.dia_semana}`);
      doc.text(`Festivo: ${r.festivo ? 'Sí' : 'No'}`);
      doc.text(`Horas trabajadas: ${r.horas_trabajadas || 0}`);
      doc.text(`Total horas extras: ${r.total_extras || 0}`);
      doc.text(`Extra diurna: ${r.extra_diurna || 0}`);
      doc.text(`Extra nocturna: ${r.extra_nocturna || 0}`);
      doc.text(`Extra festiva: ${r.extra_festiva || 0}`);
      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
 * Genera un PDF A4 apaisado con el resumen de horas por operador para un rango de fechas.
 * @param {Array<object>} resumenUsuarios - Totales por operador.
 * @param {{ horas_trabajadas: number, extra_diurna: number, extra_nocturna: number, extra_festiva: number }} totalGeneral
 * @param {string} fechaInicio
 * @param {string} fechaFin
 * @returns {Promise<Buffer>}
 */
async function generarPDFResumen(resumenUsuarios, totalGeneral, fechaInicio, fechaFin) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(18).text('RESUMEN DE HORAS POR TRABAJADOR', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Período: ${fechaInicio || 'Inicio'} al ${fechaFin || 'Hoy'}`, { align: 'center' });
      doc.moveDown(1.5);

      const tableTop = doc.y;
      const colWidths = [180, 80, 80, 80, 80, 80, 80];
      const headers = ['Nombre', 'Días', 'Horas Trab.', 'Extra Diur.', 'Extra Noct.', 'Extra Fest.', 'Total Extra'];

      doc.fontSize(10).font('Helvetica-Bold');
      let xPos = 30;
      headers.forEach((h, i) => {
        doc.text(h, xPos, tableTop, { width: colWidths[i], align: 'center' });
        xPos += colWidths[i];
      });

      doc.moveTo(30, tableTop + 15).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), tableTop + 15).stroke();

      doc.font('Helvetica').fontSize(9);
      let yPos = tableTop + 22;

      for (const u of resumenUsuarios) {
        if (yPos > 520) {
          doc.addPage();
          yPos = 50;
        }

        xPos = 30;
        const rowData = [
          u.nombre_operador,
          u.total_dias_trabajados,
          u.total_horas_trabajadas,
          u.total_extra_diurna,
          u.total_extra_nocturna,
          u.total_extra_festiva,
          u.total_horas_extras
        ];

        rowData.forEach((val, i) => {
          doc.text(String(val), xPos, yPos, { width: colWidths[i], align: i === 0 ? 'left' : 'center' });
          xPos += colWidths[i];
        });

        yPos += 18;
      }

      doc.moveTo(30, yPos).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), yPos).stroke();
      yPos += 8;

      doc.font('Helvetica-Bold').fontSize(10);
      xPos = 30;
      const totales = [
        'TOTAL GENERAL',
        resumenUsuarios.reduce((acc, u) => acc + u.total_dias_trabajados, 0),
        +totalGeneral.horas_trabajadas.toFixed(2),
        +totalGeneral.extra_diurna.toFixed(2),
        +totalGeneral.extra_nocturna.toFixed(2),
        +totalGeneral.extra_festiva.toFixed(2),
        +(totalGeneral.extra_diurna + totalGeneral.extra_nocturna + totalGeneral.extra_festiva).toFixed(2)
      ];

      totales.forEach((val, i) => {
        doc.text(String(val), xPos, yPos, { width: colWidths[i], align: i === 0 ? 'left' : 'center' });
        xPos += colWidths[i];
      });

      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
 * Genera un PDF A4 apaisado con el resumen de un único mes calendario.
 * @param {Array<object>} resumenUsuarios - Totales por operador para el mes.
 * @param {{ horas_trabajadas: number, extra_diurna: number, extra_nocturna: number, extra_festiva: number, total_extras: number }} totalMes
 * @param {string} nombreMes - Nombre legible del mes (ej. "Enero").
 * @param {string} anio - Cadena del año en cuatro dígitos.
 * @returns {Promise<Buffer>}
 */
async function generarPDFResumenMes(resumenUsuarios, totalMes, nombreMes, anio) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(18).text(`RESUMEN DE HORAS - ${nombreMes.toUpperCase()} ${anio}`, { align: 'center' });
      doc.moveDown(1.5);

      const tableTop = doc.y;
      const colWidths = [180, 80, 80, 80, 80, 80, 80];
      const headers = ['Nombre', 'Días', 'Horas Trab.', 'Extra Diur.', 'Extra Noct.', 'Extra Fest.', 'Total Extra'];

      doc.fontSize(10).font('Helvetica-Bold');
      let xPos = 30;
      headers.forEach((h, i) => {
        doc.text(h, xPos, tableTop, { width: colWidths[i], align: 'center' });
        xPos += colWidths[i];
      });

      doc.moveTo(30, tableTop + 15).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), tableTop + 15).stroke();

      doc.font('Helvetica').fontSize(9);
      let yPos = tableTop + 22;

      for (const u of resumenUsuarios) {
        if (yPos > 520) {
          doc.addPage();
          yPos = 50;
        }

        xPos = 30;
        const rowData = [
          u.nombre_operador,
          u.total_dias_trabajados,
          u.total_horas_trabajadas,
          u.total_extra_diurna,
          u.total_extra_nocturna,
          u.total_extra_festiva,
          u.total_horas_extras
        ];

        rowData.forEach((val, i) => {
          doc.text(String(val), xPos, yPos, { width: colWidths[i], align: i === 0 ? 'left' : 'center' });
          xPos += colWidths[i];
        });

        yPos += 18;
      }

      doc.moveTo(30, yPos).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), yPos).stroke();
      yPos += 8;

      doc.font('Helvetica-Bold').fontSize(10);
      xPos = 30;
      const totales = [
        'TOTAL MES',
        resumenUsuarios.reduce((acc, u) => acc + u.total_dias_trabajados, 0),
        +totalMes.horas_trabajadas.toFixed(2),
        +totalMes.extra_diurna.toFixed(2),
        +totalMes.extra_nocturna.toFixed(2),
        +totalMes.extra_festiva.toFixed(2),
        +totalMes.total_extras.toFixed(2)
      ];

      totales.forEach((val, i) => {
        doc.text(String(val), xPos, yPos, { width: colWidths[i], align: i === 0 ? 'left' : 'center' });
        xPos += colWidths[i];
      });

      doc.end();
    } catch (err) { reject(err); }
  });
}

/**
 * Construye un mapa { [nombre_obra]: sede } uniendo obras con departamentos.
 * Retorna un objeto vacío si las tablas subyacentes no existen.
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
  } catch (_) { /* las tablas pueden no existir en todos los entornos */ }
  return sedeMap;
}

/**
 * POST /administrador/admin_horas_extra/buscar
 * Retorna una lista paginada de registros de jornada con los campos de horas extras calculados agregados.
 * Soporta filtrado por nombre de operador, proyecto (obra), cliente (constructora), empresa_id(s)
 * y rango de fechas. Deduplica por ID y por clave de contenido.
 * @body {{ nombre?: string, obra?: string, constructora?: string, empresa_id?: number, empresa_ids?: number[], fecha_inicio?: string, fecha_fin?: string, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, limit: number, offset: number, rows: Array }}
 */
async function handleBuscar(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const { nombre, obra, constructora, empresa_id, empresa_ids, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    const start = formatDateOnly(fecha_inicio);
    const end = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    const ids = Array.isArray(empresa_ids) && empresa_ids.length > 0
      ? empresa_ids.filter(id => !isNaN(Number(id))).map(id => Number(id))
      : (empresa_id !== undefined && empresa_id !== null && String(empresa_id).trim() !== '' && !isNaN(Number(empresa_id)))
        ? [Number(empresa_id)]
        : null;
    if (ids && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${idx + i}`).join(', ');
      clauses.push(`empresa_id IN (${placeholders})`);
      values.push(...ids);
      idx += ids.length;
    }
    if (start) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(start); }
    if (end) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(end); }

    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const countQ = await pool.query(`SELECT COUNT(*) AS count FROM horas_jornada ${where}`, values);
    const total = parseInt(countQ.rows[0]?.count || 0, 10);

    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,
      [...values, Math.min(10000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    const sedeMap = await buildSedeMap(pool);

    const idsVistos = new Set();
    const clavesVistas = new Set();
    const rows = q.rows.reduce((acc, r) => {
      if (r.id != null && idsVistos.has(r.id)) return acc;
      if (r.id != null) idsVistos.add(r.id);
      const clave = `${r.nombre_operador}|${r.fecha_servicio}|${r.hora_ingreso}|${r.hora_salida}`;
      if (clavesVistas.has(clave)) return acc;
      clavesVistas.add(clave);
      const fecha = formatDateOnly(r.fecha_servicio);
      const calculos = (r.hora_ingreso && r.hora_salida && (r.minutos_almuerzo !== undefined))
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras:0, festivo:false, dia_semana: null };
      const total_horas = +( (calculos.horas_trabajadas || 0) ).toFixed(2);
      const sede = sedeMap[r.nombre_proyecto] || '';
      acc.push({ ...r, fecha_servicio: fecha, sede, ...calculos, total_horas });
      return acc;
    }, []);

    return res.json({ success:true, count: total, limit: parseInt(limit,10)||0, offset: parseInt(offset,10)||0, rows });
  } catch (err) {
    console.error("Error en /administrador/admin_horas_extra/buscar:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /administrador/admin_horas_extra/resumen
 * Retorna un resumen de horas extras mes a mes agrupado por operador.
 * Se requiere al menos un parámetro de filtro. Obtiene todos los registros coincidentes
 * para exactitud del resumen; aplica paginación solo a la lista plana de registros.
 * @body {{ nombre?: string, obra?: string, constructora?: string, empresa_id?: number, empresa_ids?: number[], fecha_inicio?: string, fecha_fin?: string, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, periodo: object, resumen_por_mes: Array, registros: Array }}
 * @throws {400} Si no se proporciona ningún parámetro de filtro.
 */
async function handleResumen(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const { nombre, obra, constructora, empresa_id, empresa_ids, fecha_inicio, fecha_fin, limit = 1000, offset = 0 } = req.body || {};
    const start = formatDateOnly(fecha_inicio);
    const end = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    const ids = Array.isArray(empresa_ids) && empresa_ids.length > 0
      ? empresa_ids.filter(id => !isNaN(Number(id))).map(id => Number(id))
      : (empresa_id !== undefined && empresa_id !== null && String(empresa_id).trim() !== '' && !isNaN(Number(empresa_id)))
        ? [Number(empresa_id)]
        : null;
    if (ids && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${idx + i}`).join(', ');
      clauses.push(`empresa_id IN (${placeholders})`);
      values.push(...ids);
      idx += ids.length;
    }
    if (start) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(start); }
    if (end) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(end); }

    if (clauses.length === 0) return res.status(400).json({ error: "Debes enviar al menos un parámetro de búsqueda" });

    const where = 'WHERE ' + clauses.join(' AND ');
    const countQ = await pool.query(`SELECT COUNT(*) AS count FROM horas_jornada ${where}`, values);
    const totalCount = parseInt(countQ.rows[0]?.count || 0, 10);

    const qAll = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC`,
      values
    );

    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,
      [...values, Math.min(10000, parseInt(limit) || 1000), parseInt(offset) || 0]
    );

    const registros = [];
    const resumenPorMes = {};

    for (const r of qAll.rows) {
      const fecha = formatDateOnly(r.fecha_servicio);
      const tieneHorasCompletas = r.hora_ingreso && r.hora_salida;
      const calculos = tieneHorasCompletas
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo || 0, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, festivo: false, dia_semana: null };

      const mesAnio = fecha ? fecha.slice(0, 7) : 'Sin fecha';

      if (!resumenPorMes[mesAnio]) {
        resumenPorMes[mesAnio] = {
          mes: mesAnio,
          usuarios: {},
          totales: { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0 }
        };
      }

      const operador = r.nombre_operador || 'Sin nombre';
      if (!resumenPorMes[mesAnio].usuarios[operador]) {
        resumenPorMes[mesAnio].usuarios[operador] = {
          nombre_operador: operador,
          cargo: r.cargo || '',
          total_dias_trabajados: 0,
          total_horas_trabajadas: 0,
          total_extra_diurna: 0,
          total_extra_nocturna: 0,
          total_extra_festiva: 0,
          total_horas_extras: 0,
          registros_incompletos: 0
        };
      }

      resumenPorMes[mesAnio].usuarios[operador].total_dias_trabajados += 1;
      if (!tieneHorasCompletas) {
        resumenPorMes[mesAnio].usuarios[operador].registros_incompletos += 1;
      }
      resumenPorMes[mesAnio].usuarios[operador].total_horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_extras += calculos.total_extras || 0;

      resumenPorMes[mesAnio].totales.horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].totales.extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].totales.extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].totales.extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].totales.total_extras += calculos.total_extras || 0;
    }

    for (const r of q.rows) {
      const fecha = formatDateOnly(r.fecha_servicio);
      const tieneHorasCompletas = r.hora_ingreso && r.hora_salida;
      const calculos = tieneHorasCompletas
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo || 0, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, festivo: false, dia_semana: null };

      registros.push({ ...r, fecha_servicio: fecha, ...calculos, registro_incompleto: !tieneHorasCompletas });
    }

    const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const resumenMeses = Object.keys(resumenPorMes)
      .sort()
      .map(mesAnio => {
        const [anio, mes] = mesAnio.split('-');
        const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;

        const usuarios = Object.values(resumenPorMes[mesAnio].usuarios).map(u => ({
          ...u,
          total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
          total_extra_diurna: +u.total_extra_diurna.toFixed(2),
          total_extra_nocturna: +u.total_extra_nocturna.toFixed(2),
          total_extra_festiva: +u.total_extra_festiva.toFixed(2),
          total_horas_extras: +u.total_horas_extras.toFixed(2)
        })).sort((a, b) => a.nombre_operador.localeCompare(b.nombre_operador));

        return {
          mes: mesAnio,
          mes_nombre: `${nombreMes} ${anio}`,
          resumen_usuarios: usuarios,
          totales: {
            total_horas_trabajadas: +resumenPorMes[mesAnio].totales.horas_trabajadas.toFixed(2),
            total_extra_diurna: +resumenPorMes[mesAnio].totales.extra_diurna.toFixed(2),
            total_extra_nocturna: +resumenPorMes[mesAnio].totales.extra_nocturna.toFixed(2),
            total_extra_festiva: +resumenPorMes[mesAnio].totales.extra_festiva.toFixed(2),
            total_horas_extras: +resumenPorMes[mesAnio].totales.total_extras.toFixed(2)
          }
        };
      });

    return res.json({
      success: true,
      count: totalCount,
      limit: parseInt(limit,10)||0,
      offset: parseInt(offset,10)||0,
      periodo: {
        fecha_inicio: start || null,
        fecha_fin: end
      },
      resumen_por_mes: resumenMeses,
      registros
    });
  } catch (err) {
    console.error("Error en /administrador/admin_horas_extra/resumen:", err);
    return res.status(500).json({ success:false, error: err.message });
  }
}

/**
 * POST /administrador/admin_horas_extra/descargar
 * Exporta registros de jornada en el formato solicitado.
 * - `excel`: XLSX con múltiples hojas; una hoja de resumen por mes calendario + una hoja de registros detallados.
 * - `pdf`: Archivo ZIP con un PDF de resumen mensual más un PDF por cada registro individual.
 * - Por defecto: CSV con todos los campos calculados.
 * @body {{ nombre?: string, obra?: string, constructora?: string, empresa_id?: number, empresa_ids?: number[], fecha_inicio?: string, fecha_fin?: string, formato?: 'excel'|'pdf'|'csv', limit?: number }}
 * @returns {Buffer} Adjunto en el formato solicitado.
 */
async function handleDescargar(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const { nombre, obra, constructora, empresa_id, empresa_ids, fecha_inicio, fecha_fin, formato = 'excel', limit = 50000 } = req.body || {};
    const start = formatDateOnly(fecha_inicio);
    const end = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    const ids = Array.isArray(empresa_ids) && empresa_ids.length > 0
      ? empresa_ids.filter(id => !isNaN(Number(id))).map(id => Number(id))
      : (empresa_id !== undefined && empresa_id !== null && String(empresa_id).trim() !== '' && !isNaN(Number(empresa_id)))
        ? [Number(empresa_id)]
        : null;
    if (ids && ids.length > 0) {
      const placeholders = ids.map((_, i) => `$${idx + i}`).join(', ');
      clauses.push(`empresa_id IN (${placeholders})`);
      values.push(...ids);
      idx += ids.length;
    }
    if (start) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(start); }
    if (end) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(end); }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1}`,
      [...values, Math.min(50000, parseInt(limit,10)||50000)]
    );

    const sedeMap = await buildSedeMap(pool);

    const rows = [];
    const idsVistos = new Set();
    const clavesVistas = new Set();
    const resumenPorMes = {};
    const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    for (const r of q.rows) {
      if (r.id != null && idsVistos.has(r.id)) continue;
      if (r.id != null) idsVistos.add(r.id);
      const clave = `${r.nombre_operador}|${r.fecha_servicio}|${r.hora_ingreso}|${r.hora_salida}`;
      if (clavesVistas.has(clave)) continue;
      clavesVistas.add(clave);
      const fecha = formatDateOnly(r.fecha_servicio);
      const calculos = (r.hora_ingreso && r.hora_salida && (r.minutos_almuerzo !== undefined))
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras:0, festivo:false, dia_semana:null };
      const total_horas = +(calculos.horas_trabajadas || 0).toFixed(2);
      const sede = sedeMap[r.nombre_proyecto] || '';
      rows.push({ ...r, fecha_servicio: fecha, sede, ...calculos, total_horas });

      const mesAnio = fecha ? fecha.slice(0, 7) : 'Sin fecha';

      if (!resumenPorMes[mesAnio]) {
        resumenPorMes[mesAnio] = {
          mes: mesAnio,
          usuarios: {},
          totales: { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0 }
        };
      }

      const operador = r.nombre_operador || 'Sin nombre';
      if (!resumenPorMes[mesAnio].usuarios[operador]) {
        resumenPorMes[mesAnio].usuarios[operador] = {
          nombre_operador: operador,
          cargo: r.cargo || '',
          sede: sedeMap[r.nombre_proyecto] || '',
          total_dias_trabajados: 0,
          total_horas_trabajadas: 0,
          total_extra_diurna: 0,
          total_extra_nocturna: 0,
          total_extra_festiva: 0,
          total_horas_extras: 0
        };
      }

      resumenPorMes[mesAnio].usuarios[operador].total_dias_trabajados += 1;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_extras += calculos.total_extras || 0;

      resumenPorMes[mesAnio].totales.horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].totales.extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].totales.extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].totales.extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].totales.total_extras += calculos.total_extras || 0;
    }

    const mesesOrdenados = Object.keys(resumenPorMes).sort();

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();

      for (const mesAnio of mesesOrdenados) {
        const [anio, mes] = mesAnio.split('-');
        const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;
        const nombreHoja = `${nombreMes} ${anio}`;

        const resumenUsuarios = Object.values(resumenPorMes[mesAnio].usuarios).map(u => ({
          ...u,
          total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
          total_extra_diurna: +u.total_extra_diurna.toFixed(2),
          total_extra_nocturna: +u.total_extra_nocturna.toFixed(2),
          total_extra_festiva: +u.total_extra_festiva.toFixed(2),
          total_horas_extras: +u.total_horas_extras.toFixed(2)
        })).sort((a, b) => a.nombre_operador.localeCompare(b.nombre_operador));

        const totalMes = resumenPorMes[mesAnio].totales;

        const wsResumen = workbook.addWorksheet(nombreHoja);

        wsResumen.mergeCells('A1:I1');
        wsResumen.getCell('A1').value = `RESUMEN DE HORAS - ${nombreMes.toUpperCase()} ${anio}`;
        wsResumen.getCell('A1').font = { bold: true, size: 14 };
        wsResumen.getCell('A1').alignment = { horizontal: 'center' };

        const colNames = ['Nombre', 'Cargo', 'Sede', 'Días Trabajados', 'Horas Trabajadas', 'Extra Diurna', 'Extra Nocturna', 'Extra Festiva', 'Total Extras'];
        wsResumen.addTable({
          name: `TablaResumen_${mesAnio.replace('-', '_')}`,
          ref: 'A3',
          headerRow: true,
          totalsRow: false,
          style: { theme: 'TableStyleMedium2', showRowStripes: true },
          columns: colNames.map(n => ({ name: n, filterButton: true })),
          rows: resumenUsuarios.map(u => [
            u.nombre_operador, u.cargo, u.sede, u.total_dias_trabajados,
            u.total_horas_trabajadas, u.total_extra_diurna,
            u.total_extra_nocturna, u.total_extra_festiva, u.total_horas_extras
          ])
        });

        const totalRow = 4 + resumenUsuarios.length;
        wsResumen.getRow(totalRow).values = [
          'TOTAL MES', '', '',
          resumenUsuarios.reduce((acc, u) => acc + u.total_dias_trabajados, 0),
          +totalMes.horas_trabajadas.toFixed(2),
          +totalMes.extra_diurna.toFixed(2),
          +totalMes.extra_nocturna.toFixed(2),
          +totalMes.extra_festiva.toFixed(2),
          +totalMes.total_extras.toFixed(2)
        ];
        wsResumen.getRow(totalRow).font = { bold: true };
        wsResumen.getRow(totalRow).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C8E6C9' } }; });

        [30, 20, 20, 18, 18, 15, 15, 15, 15].forEach((w, i) => { wsResumen.getColumn(i + 1).width = w; });
      }

      const ws = workbook.addWorksheet('Registros Detallados');
      if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        ws.addTable({
          name: 'TablaRegistrosDetallados',
          ref: 'A1',
          headerRow: true,
          totalsRow: false,
          style: { theme: 'TableStyleMedium2', showRowStripes: true },
          columns: keys.map(k => ({ name: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), filterButton: true })),
          rows: rows.map(r => keys.map(k => {
            let val = r[k];
            if (k === 'fecha_servicio') return val ? val : '';
            if (k === 'hora_ingreso' || k === 'hora_salida') return val ? String(val).slice(0, 5) : '';
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') { try { return JSON.stringify(val); } catch(e) { return String(val); } }
            return val;
          }))
        });
        keys.forEach((k, i) => {
          ws.getColumn(i + 1).width = Math.min(60, Math.max(12, k.replace(/_/g, ' ').length + 4));
        });
      }
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=horas_jornada.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!rows || rows.length === 0) return res.status(404).json({ success:false, error:'No se encontraron registros' });
      res.setHeader('Content-Type','application/zip');
      res.setHeader('Content-Disposition','attachment; filename="horas_jornada.zip"');
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', err => { console.error('Archiver error:', err); try{ res.status(500).end(); } catch(e){} });
      archive.pipe(res);

      for (let i = 0; i < mesesOrdenados.length; i++) {
        const mesAnio = mesesOrdenados[i];
        const [anio, mes] = mesAnio.split('-');
        const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;

        const resumenUsuarios = Object.values(resumenPorMes[mesAnio].usuarios).map(u => ({
          ...u,
          total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
          total_extra_diurna: +u.total_extra_diurna.toFixed(2),
          total_extra_nocturna: +u.total_extra_nocturna.toFixed(2),
          total_extra_festiva: +u.total_extra_festiva.toFixed(2),
          total_horas_extras: +u.total_horas_extras.toFixed(2)
        })).sort((a, b) => a.nombre_operador.localeCompare(b.nombre_operador));

        const totalMes = resumenPorMes[mesAnio].totales;

        try {
          const resumenPdf = await generarPDFResumenMes(resumenUsuarios, totalMes, nombreMes, anio);
          const numStr = String(i + 1).padStart(2, '0');
          archive.append(resumenPdf, { name: `${numStr}_RESUMEN_${nombreMes.toUpperCase()}_${anio}.pdf` });
        } catch (err) {
          archive.append(`Error generando PDF de resumen: ${err.message||err}`, { name: `error_resumen_${mesAnio}.txt` });
        }
      }

      for (const r of rows) {
        try {
          const buf = await generarPDFPorRegistro(r);
          const nameSafe = (r.nombre_operador || 'operador').replace(/\s+/g,'_');
          archive.append(buf, { name: `horas_jornada_${nameSafe}_${r.fecha_servicio}.pdf` });
        } catch (err) {
          archive.append(`Error generando PDF para registro: ${err.message||err}`, { name: `error.txt` });
        }
      }
      await archive.finalize();
      return;
    }

    // CSV fallback
    const keys = rows[0] ? Object.keys(rows[0]) : [];
    const header = keys.length ? keys : ['nombre_operador','fecha_servicio','horas_trabajadas','extra_diurna','extra_nocturna','extra_festiva','total_horas'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const rowArr = header.map(k => {
        let val = r[k];
        if (k === 'fecha_servicio') val = val ? val : '';
        else if (val === null || val === undefined) val = '';
        else if (typeof val === 'object') { try { val = JSON.stringify(val); } catch(e){ val = String(val); } }
        return `"${String(val).replace(/"/g,'""')}"`;
      });
      lines.push(rowArr.join(','));
    }
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition','attachment; filename="horas_jornada.csv"');
    return res.send(lines.join('\r\n'));

  } catch (err) {
    console.error('Error en admin_horas_extra /descargar:', err);
    return res.status(500).json({ success:false, error: err.message });
  }
}

/**
 * GET /administrador/admin_horas_extra/search
 * Endpoint de consulta liviano usando el helper genérico `buildWhere`.
 * Acepta filtros por query string; establece automáticamente `fecha_to` a hoy cuando solo se provee `fecha_from`.
 * @query {{ nombre_cliente?, nombre_proyecto?, fecha?, fecha_from?, fecha_to?, nombre_operador?, empresa_id?, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, rows: Array }}
 */
async function handleSearch(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    if (req.query && req.query.fecha_from && !req.query.fecha_to) req.query.fecha_to = todayDateString();
    const allowed = ['nombre_cliente','nombre_proyecto','fecha','fecha_from','fecha_to','nombre_operador','empresa_id'];
    const { where, values } = buildWhere(req.query, allowed);
    const limit = Math.min(500, parseInt(req.query.limit) || 100);
    const offset = parseInt(req.query.offset) || 0;
    const finalQuery = `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`;
    const q = await pool.query(finalQuery, [...values, limit, offset]);
    return res.json({ success: true, count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error("Error searching horas_jornada:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

router.get("/search", handleSearch);
router.get("/administrador/admin_horas_extra/search", handleSearch);

router.post("/buscar", handleBuscar);
router.post("/administrador/admin_horas_extra/buscar", handleBuscar);

router.post("/resumen", handleResumen);
router.post("/administrador/admin_horas_extra/resumen", handleResumen);

router.post("/descargar", handleDescargar);
router.post("/administrador/admin_horas_extra/descargar", handleDescargar);

export default router;
