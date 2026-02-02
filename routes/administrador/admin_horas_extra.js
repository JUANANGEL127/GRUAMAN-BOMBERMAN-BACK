import express from "express";
import { DateTime } from "luxon";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import archiver from "archiver";
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
function buildWhere(params, allowedFields = []) {
  const clauses = [];
  const values = [];
  let idx = 1;
  for (const key of Object.keys(params || {})) {
    const val = params[key];
    if ((val === undefined || val === "") || !allowedFields.includes(key)) continue;
    if (key === 'fecha_from') {
      clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`);
      values.push(formatDateOnly(val));
    } else if (key === 'fecha_to') {
      clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`);
      values.push(formatDateOnly(val));
    } else if (key === 'fecha') {
      clauses.push(`CAST(fecha_servicio AS date) = $${idx++}`);
      values.push(formatDateOnly(val));
    } else if (key === 'empresa_id') {
      clauses.push(`empresa_id = $${idx++}`);
      values.push(Number(val));
    } else {
      clauses.push(`${key} ILIKE $${idx++}`);
      values.push(`%${val}%`);
    }
  }
  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', values };
}

// Festivos fijos (MM-DD)
const FESTIVOS_FIJOS = ["-01-01","-05-01","-07-20","-12-25"];
function esFestivo(fechaISO) {
  const dt = DateTime.fromISO(fechaISO, { zone: "America/Bogota" });
  const mesDia = dt.toFormat("-MM-dd");
  return dt.weekday === 7 || FESTIVOS_FIJOS.includes(mesDia);
}

// Cálculo de horas y extras (por minuto, zona Colombia)
function calcularHoras({ hora_ingreso, hora_salida, minutos_almuerzo = 0, fecha }) {
  const zone = "America/Bogota";
  // Asegurar formatos 'HH:mm[:ss]'
  const hhIn = String(hora_ingreso || "").trim();
  const hhOut = String(hora_salida || "").trim();
  if (!hhIn || !hhOut) return null;

  const dtIngreso = DateTime.fromISO(`${fecha}T${hhIn}`, { zone });
  let dtSalida = DateTime.fromISO(`${fecha}T${hhOut}`, { zone });
  if (!dtIngreso.isValid || !dtSalida.isValid) return null;
  if (dtSalida < dtIngreso) dtSalida = dtSalida.plus({ days: 1 });

  let minutosTotales = Math.max(0, Math.round(dtSalida.diff(dtIngreso, "minutes").minutes) - (minutos_almuerzo || 0));
  const horasTrabajadas = +(minutosTotales / 60).toFixed(2);

  const jornadaBaseMin = 8 * 60; // 8 horas base
  const festivo = esFestivo(fecha);

  let minutosExtraDiurna = 0;
  let minutosExtraNocturna = 0;
  let minutosExtraFestiva = 0;
  let minutosNormales = 0;

  if (festivo) {
    // todas las horas son festivas
    minutosExtraFestiva = minutosTotales;
  } else {
    // contemos minuto a minuto, restando la jornadaBaseMin como minutos normales
    let actual = dtIngreso;
    let resto = minutosTotales;
    let minutosBase = jornadaBaseMin;
    while (resto > 0) {
      const hour = actual.setZone(zone).hour;
      const isDiurna = hour >= 6 && hour < 21; // 6:00 - 21:00 diurna
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
  // total extras sumar todos
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

// usa global.db
let db;
function ensureDb() {
  if (!global.db) throw new Error("global.db no está definido. Importa este router después de inicializar la DB.");
  return global.db;
}

// Helper: genera PDF buffer para un registro con cálculos
async function generarPDFPorRegistro(r) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      doc.fontSize(16).text(`Horas Jornada - ${r.nombre_operador || ''}`, { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Fecha: ${r.fecha_servicio ? (new Date(r.fecha_servicio)).toISOString().slice(0,10) : ''}`);
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

// Helper: genera PDF buffer para resumen por usuario
async function generarPDFResumen(resumenUsuarios, totalGeneral, fechaInicio, fechaFin) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      // Título
      doc.fontSize(18).text('RESUMEN DE HORAS POR TRABAJADOR', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Período: ${fechaInicio || 'Inicio'} al ${fechaFin || 'Hoy'}`, { align: 'center' });
      doc.moveDown(1.5);

      // Tabla de resumen
      const tableTop = doc.y;
      const colWidths = [180, 80, 80, 80, 80, 80, 80];
      const headers = ['Nombre', 'Días', 'Horas Trab.', 'Extra Diur.', 'Extra Noct.', 'Extra Fest.', 'Total Extra'];
      
      // Encabezados
      doc.fontSize(10).font('Helvetica-Bold');
      let xPos = 30;
      headers.forEach((h, i) => {
        doc.text(h, xPos, tableTop, { width: colWidths[i], align: 'center' });
        xPos += colWidths[i];
      });
      
      // Línea separadora
      doc.moveTo(30, tableTop + 15).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), tableTop + 15).stroke();
      
      // Datos
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
      
      // Línea antes de totales
      doc.moveTo(30, yPos).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), yPos).stroke();
      yPos += 8;
      
      // Fila de totales
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

// Helper: genera PDF buffer para resumen de un mes específico
async function generarPDFResumenMes(resumenUsuarios, totalMes, nombreMes, anio) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
      const bufs = [];
      doc.on('data', b => bufs.push(b));
      doc.on('end', () => resolve(Buffer.concat(bufs)));

      // Título
      doc.fontSize(18).text(`RESUMEN DE HORAS - ${nombreMes.toUpperCase()} ${anio}`, { align: 'center' });
      doc.moveDown(1.5);

      // Tabla de resumen
      const tableTop = doc.y;
      const colWidths = [180, 80, 80, 80, 80, 80, 80];
      const headers = ['Nombre', 'Días', 'Horas Trab.', 'Extra Diur.', 'Extra Noct.', 'Extra Fest.', 'Total Extra'];
      
      // Encabezados
      doc.fontSize(10).font('Helvetica-Bold');
      let xPos = 30;
      headers.forEach((h, i) => {
        doc.text(h, xPos, tableTop, { width: colWidths[i], align: 'center' });
        xPos += colWidths[i];
      });
      
      // Línea separadora
      doc.moveTo(30, tableTop + 15).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), tableTop + 15).stroke();
      
      // Datos
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
      
      // Línea antes de totales
      doc.moveTo(30, yPos).lineTo(30 + colWidths.reduce((a,b) => a+b, 0), yPos).stroke();
      yPos += 8;
      
      // Fila de totales
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

// --- extraigo handlers para poder registrar alias absolutos ---

// handler para POST /buscar
async function handleBuscar(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const { nombre, obra, constructora, empresa_id, fecha_inicio, fecha_fin, limit = 200, offset = 0 } = req.body || {};
    const start = formatDateOnly(fecha_inicio);
    const end = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (empresa_id !== undefined && empresa_id !== null && String(empresa_id).trim() !== '' && !isNaN(Number(empresa_id))) { clauses.push(`empresa_id = $${idx++}`); values.push(Number(empresa_id)); }
    if (start) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(start); }
    if (end) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(end); }

    const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
    const countQ = await pool.query(`SELECT COUNT(*) AS count FROM horas_jornada ${where}`, values);
    const total = parseInt(countQ.rows[0]?.count || 0, 10);

    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,
      [...values, Math.min(10000, parseInt(limit) || 200), parseInt(offset) || 0]
    );

    const rows = q.rows.map(r => {
      const fecha = r.fecha_servicio && r.fecha_servicio.toISOString ? r.fecha_servicio.toISOString().slice(0,10) : formatDateOnly(r.fecha_servicio);
      const calculos = (r.hora_ingreso && r.hora_salida && (r.minutos_almuerzo !== undefined))
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras:0, festivo:false, dia_semana: null };
      const total_horas = +( (calculos.horas_trabajadas || 0) ).toFixed(2);
      return { ...r, fecha_servicio: fecha, ...calculos, total_horas };
    });

    return res.json({ success:true, count: total, limit: parseInt(limit,10)||0, offset: parseInt(offset,10)||0, rows });
  } catch (err) {
    console.error("Error en /administrador/admin_horas_extra/buscar:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// handler para POST /resumen
async function handleResumen(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const { nombre, obra, constructora, empresa_id, fecha_inicio, fecha_fin, limit = 1000, offset = 0 } = req.body || {};
    const start = formatDateOnly(fecha_inicio);
    const end = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (empresa_id !== undefined && empresa_id !== null && String(empresa_id).trim() !== '' && !isNaN(Number(empresa_id))) { clauses.push(`empresa_id = $${idx++}`); values.push(Number(empresa_id)); }
    if (start) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(start); }
    if (end) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(end); }

    if (clauses.length === 0) return res.status(400).json({ error: "Debes enviar al menos un parámetro de búsqueda" });

    const where = 'WHERE ' + clauses.join(' AND ');
    const countQ = await pool.query(`SELECT COUNT(*) AS count FROM horas_jornada ${where}`, values);
    const totalCount = parseInt(countQ.rows[0]?.count || 0, 10);

    // Para el resumen, obtener TODOS los registros (sin limit) para calcular correctamente
    const qAll = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC`,
      values
    );

    // Para la lista de registros, aplicar paginación
    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,
      [...values, Math.min(10000, parseInt(limit) || 1000), parseInt(offset) || 0]
    );

    const registros = [];
    // Objeto para agrupar por MES y luego por usuario (usando TODOS los registros)
    const resumenPorMes = {};

    // Procesar TODOS los registros para el resumen (sin paginación)
    for (const r of qAll.rows) {
      const fecha = r.fecha_servicio && r.fecha_servicio.toISOString ? r.fecha_servicio.toISOString().slice(0,10) : formatDateOnly(r.fecha_servicio);
      
      // Calcular horas si tiene los datos completos, sino usar valores por defecto
      const tieneHorasCompletas = r.hora_ingreso && r.hora_salida;
      const calculos = tieneHorasCompletas
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo || 0, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, festivo: false, dia_semana: null };

      // Extraer mes-año de la fecha (ej: "2026-02")
      const mesAnio = fecha ? fecha.slice(0, 7) : 'Sin fecha';
      
      if (!resumenPorMes[mesAnio]) {
        resumenPorMes[mesAnio] = {
          mes: mesAnio,
          usuarios: {},
          totales: { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0 }
        };
      }

      // Agrupar por nombre_operador dentro del mes
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

      // Totales del mes
      resumenPorMes[mesAnio].totales.horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].totales.extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].totales.extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].totales.extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].totales.total_extras += calculos.total_extras || 0;
    }

    // Procesar solo los registros paginados para la lista de resultados
    for (const r of q.rows) {
      const fecha = r.fecha_servicio && r.fecha_servicio.toISOString ? r.fecha_servicio.toISOString().slice(0,10) : formatDateOnly(r.fecha_servicio);
      const tieneHorasCompletas = r.hora_ingreso && r.hora_salida;
      const calculos = tieneHorasCompletas
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo || 0, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, festivo: false, dia_semana: null };
      
      registros.push({ ...r, fecha_servicio: fecha, ...calculos, registro_incompleto: !tieneHorasCompletas });
    }

    // Convertir a array ordenado por mes y formatear
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

// handler para POST /descargar
async function handleDescargar(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const { nombre, obra, constructora, empresa_id, fecha_inicio, fecha_fin, formato = 'excel', limit = 50000 } = req.body || {};
    const start = formatDateOnly(fecha_inicio);
    const end = formatDateOnly(fecha_fin) || todayDateString();

    const clauses = [];
    const values = [];
    let idx = 1;
    if (nombre) { clauses.push(`nombre_operador ILIKE $${idx++}`); values.push(`%${nombre}%`); }
    if (obra) { clauses.push(`nombre_proyecto ILIKE $${idx++}`); values.push(`%${obra}%`); }
    if (constructora) { clauses.push(`nombre_cliente ILIKE $${idx++}`); values.push(`%${constructora}%`); }
    if (empresa_id !== undefined && empresa_id !== null && String(empresa_id).trim() !== '' && !isNaN(Number(empresa_id))) { clauses.push(`empresa_id = $${idx++}`); values.push(Number(empresa_id)); }
    if (start) { clauses.push(`CAST(fecha_servicio AS date) >= $${idx++}`); values.push(start); }
    if (end) { clauses.push(`CAST(fecha_servicio AS date) <= $${idx++}`); values.push(end); }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1}`,
      [...values, Math.min(50000, parseInt(limit,10)||50000)]
    );

    const rows = [];
    // Objeto para agrupar por MES y luego por usuario
    const resumenPorMes = {};
    const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    for (const r of q.rows) {
      const fecha = r.fecha_servicio && r.fecha_servicio.toISOString ? r.fecha_servicio.toISOString().slice(0,10) : formatDateOnly(r.fecha_servicio);
      const calculos = (r.hora_ingreso && r.hora_salida && (r.minutos_almuerzo !== undefined))
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, minutos_almuerzo: r.minutos_almuerzo, fecha })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras:0, festivo:false, dia_semana:null };
      const total_horas = +(calculos.horas_trabajadas || 0).toFixed(2);
      rows.push({ ...r, fecha_servicio: fecha, ...calculos, total_horas });

      // Extraer mes-año de la fecha (ej: "2026-02")
      const mesAnio = fecha ? fecha.slice(0, 7) : 'Sin fecha';
      
      if (!resumenPorMes[mesAnio]) {
        resumenPorMes[mesAnio] = {
          mes: mesAnio,
          usuarios: {},
          totales: { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0 }
        };
      }

      // Agrupar por nombre_operador dentro del mes
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
          total_horas_extras: 0
        };
      }
      
      resumenPorMes[mesAnio].usuarios[operador].total_dias_trabajados += 1;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_extras += calculos.total_extras || 0;

      // Totales del mes
      resumenPorMes[mesAnio].totales.horas_trabajadas += calculos.horas_trabajadas || 0;
      resumenPorMes[mesAnio].totales.extra_diurna += calculos.extra_diurna || 0;
      resumenPorMes[mesAnio].totales.extra_nocturna += calculos.extra_nocturna || 0;
      resumenPorMes[mesAnio].totales.extra_festiva += calculos.extra_festiva || 0;
      resumenPorMes[mesAnio].totales.total_extras += calculos.total_extras || 0;
    }

    // Convertir a array ordenado por mes
    const mesesOrdenados = Object.keys(resumenPorMes).sort();

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();
      
      // Una hoja por cada mes
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
        
        // Título y período
        wsResumen.mergeCells('A1:H1');
        wsResumen.getCell('A1').value = `RESUMEN DE HORAS - ${nombreMes.toUpperCase()} ${anio}`;
        wsResumen.getCell('A1').font = { bold: true, size: 14 };
        wsResumen.getCell('A1').alignment = { horizontal: 'center' };
        
        // Encabezados
        wsResumen.getRow(3).values = ['Nombre', 'Cargo', 'Días Trabajados', 'Horas Trabajadas', 'Extra Diurna', 'Extra Nocturna', 'Extra Festiva', 'Total Extras'];
        wsResumen.getRow(3).font = { bold: true };
        wsResumen.getRow(3).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0B2' } }; });
        
        // Datos
        resumenUsuarios.forEach((u, i) => {
          wsResumen.getRow(4 + i).values = [
            u.nombre_operador,
            u.cargo,
            u.total_dias_trabajados,
            u.total_horas_trabajadas,
            u.total_extra_diurna,
            u.total_extra_nocturna,
            u.total_extra_festiva,
            u.total_horas_extras
          ];
        });
        
        // Fila de totales
        const totalRow = 4 + resumenUsuarios.length;
        wsResumen.getRow(totalRow).values = [
          'TOTAL MES', '',
          resumenUsuarios.reduce((acc, u) => acc + u.total_dias_trabajados, 0),
          +totalMes.horas_trabajadas.toFixed(2),
          +totalMes.extra_diurna.toFixed(2),
          +totalMes.extra_nocturna.toFixed(2),
          +totalMes.extra_festiva.toFixed(2),
          +totalMes.total_extras.toFixed(2)
        ];
        wsResumen.getRow(totalRow).font = { bold: true };
        wsResumen.getRow(totalRow).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C8E6C9' } }; });
        
        // Ajustar anchos
        wsResumen.columns = [
          { width: 30 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 15 }
        ];
      }

      // Última hoja: Registros Detallados
      const ws = workbook.addWorksheet('Registros Detallados');
      if (rows.length > 0) {
        const keys = Object.keys(rows[0]);
        ws.columns = keys.map(k => ({ header: k.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase()), key: k, width: 20 }));
        rows.forEach(r => {
          const rowObj = {};
          ws.columns.forEach(col => {
            let val = r[col.key];
            if (col.key === 'fecha_servicio') val = val ? val : '';
            else if (val === null || val === undefined) val = '';
            else if (typeof val === 'object') { try { val = JSON.stringify(val); } catch(e){ val = String(val); } }
            rowObj[col.key] = val;
          });
          ws.addRow(rowObj);
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

      // Un PDF de resumen por cada mes
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

      // PDFs individuales
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

    // fallback CSV
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

// handler para GET /search
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

// registro de rutas existentes y alias absolutos
router.get("/search", handleSearch);
router.get("/administrador/admin_horas_extra/search", handleSearch);

router.post("/buscar", handleBuscar);
router.post("/administrador/admin_horas_extra/buscar", handleBuscar);

router.post("/resumen", handleResumen);
router.post("/administrador/admin_horas_extra/resumen", handleResumen);

router.post("/descargar", handleDescargar);
router.post("/administrador/admin_horas_extra/descargar", handleDescargar);

export default router;
