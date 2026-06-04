import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { DateTime } from "luxon";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { formatDateOnly, parseDateLocal, todayDateString } from '../../helpers/dateUtils.js';
import { buildWhere } from '../../helpers/queryBuilder.js';
import { toFiniteCoordinate } from '../../helpers/locationValidation.js';
const router = express.Router();

const REPORT_ASSET_DIR = process.env.REPORT_ASSETS_DIR
  || path.join(process.cwd(), 'assets', 'report');
const REPORT_BRAND_ASSETS = [
  { label: 'Central', file: 'logopiegye.png' },
  { label: 'Gruaman', file: 'gruaman.png' },
  { label: 'Bomber Man', file: 'bomberman.png' },
];
const REPORT_TEMP_DIR = path.join(os.tmpdir(), 'gruaman-bomberman-back', 'horas-extra-pdf-jobs');
const REPORT_JOB_RETENTION_MS = Math.max(
  15 * 60 * 1000,
  Number.parseInt(process.env.REPORT_PDF_JOB_RETENTION_MS || '', 10) || 2 * 60 * 60 * 1000
);
const REPORT_PDF_JOBS = new Map();

function ensureReportTempDir() {
  try {
    fs.mkdirSync(REPORT_TEMP_DIR, { recursive: true });
  } catch (_) { /* no-op */ }
}

function getReportJobDownloadUrl(jobId) {
  return `/administrador/admin_horas_extra/pdf-jobs/${jobId}/download`;
}

function normalizeReportJobRecord(job) {
  if (!job) return null;
  return {
    jobId: job.jobId,
    status: job.status,
    message: job.message,
    downloadUrl: job.status === 'ready' ? getReportJobDownloadUrl(job.jobId) : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    expiresAt: job.expiresAt || null
  };
}

function storeReportJob(job) {
  REPORT_PDF_JOBS.set(job.jobId, job);
  return job;
}

function scheduleReportJobCleanup(jobId, delayMs = REPORT_JOB_RETENTION_MS) {
  const job = REPORT_PDF_JOBS.get(jobId);
  if (!job) return;
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    const current = REPORT_PDF_JOBS.get(jobId);
    if (!current) return;
    if (current.filePath) {
      try { fs.unlinkSync(current.filePath); } catch (_) { /* ignore */ }
    }
    REPORT_PDF_JOBS.delete(jobId);
  }, delayMs);
  if (typeof job.cleanupTimer?.unref === 'function') job.cleanupTimer.unref();
}

function createReportJobRecord(payload = {}) {
  const now = new Date().toISOString();
  const job = {
    jobId: randomUUID(),
    status: 'pending',
    message: 'El reporte fue encolado correctamente.',
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    filePath: null,
    fileName: 'horas_jornada_compilado.pdf',
    error: null,
    ...payload
  };
  return storeReportJob(job);
}

function updateReportJob(jobId, patch = {}) {
  const job = REPORT_PDF_JOBS.get(jobId);
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  return job;
}

function getReportJob(jobId) {
  const job = REPORT_PDF_JOBS.get(jobId);
  if (!job) return null;
  if (job.expiresAt && Date.now() > job.expiresAt) {
    if (job.filePath) {
      try { fs.unlinkSync(job.filePath); } catch (_) { /* ignore */ }
    }
    REPORT_PDF_JOBS.delete(jobId);
    return null;
  }
  return job;
}

function finalizeReportJob(jobId, status, message, extra = {}) {
  const job = getReportJob(jobId);
  if (!job) return null;
  Object.assign(job, extra, {
    status,
    message,
    updatedAt: new Date().toISOString()
  });
  if (status === 'ready' || status === 'error') {
    job.expiresAt = Date.now() + REPORT_JOB_RETENTION_MS;
    scheduleReportJobCleanup(jobId, REPORT_JOB_RETENTION_MS);
  }
  return job;
}

function buildReportJobResponseAdapter(fileStream) {
  const adapter = fileStream;
  adapter.__statusCode = 200;
  adapter.__jsonPayload = null;
  adapter.setHeader = () => adapter;
  adapter.status = (code) => {
    adapter.__statusCode = code;
    return adapter;
  };
  adapter.json = (payload) => {
    adapter.__jsonPayload = payload;
    return adapter;
  };
  return adapter;
}

function resolveReportAssetPath(fileName) {
  const candidates = [
    process.env.REPORT_ASSETS_DIR ? path.join(process.env.REPORT_ASSETS_DIR, fileName) : null,
    path.join(REPORT_ASSET_DIR, fileName)
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function safeReportText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: 'utc' }).setZone('America/Bogota').toFormat('yyyy-LL-dd HH:mm:ss');
  }
  return String(value);
}

function resolveRolName(source, empresaMap = {}) {
  const empresaKey = source?.empresaId != null
    ? String(source.empresaId)
    : source?.empresa_id != null
      ? String(source.empresa_id)
      : '';

  return String(
    empresaMap?.[empresaKey]
    || source?.rol
    || source?.empresaNombre
    || source?.empresa_nombre
    || source?.empresa
    || empresaKey
    || source?.cargo
    || ''
  ).trim();
}

function normalizeReportToken(value) {
  return String(value ?? '').trim().toLowerCase();
}

function resolveAdminReportProfile(req) {
  const user = req?.auth?.user || {};
  const candidates = [
    user.adminRole,
    ...(Array.isArray(user.roles) ? user.roles : []),
    ...(Array.isArray(user.permissions) ? user.permissions : [])
  ]
    .map(normalizeReportToken)
    .filter(Boolean);

  if (candidates.some((token) => token.includes('gruaman'))) return 'gruaman';
  if (candidates.some((token) => token.includes('bomberman'))) return 'bomberman';
  return 'gruaman';
}

function createZeroPayrollBuckets() {
  return {
    jornada_normal: 0,
    hed: 0,
    hen: 0,
    rn: 0,
    fest: 0,
    rfn: 0,
    hedf: 0,
    henf: 0,
    payroll_total_extras: 0
  };
}

function minutesToHours(minutes) {
  return +(minutes / 60).toFixed(2);
}

function getWindowInterval(dateISO, startMinutes, endMinutes, zone = 'America/Bogota') {
  const start = DateTime.fromISO(dateISO, { zone }).startOf('day').plus({ minutes: startMinutes });
  let end = DateTime.fromISO(dateISO, { zone }).startOf('day').plus({ minutes: endMinutes });
  if (endMinutes <= startMinutes) end = end.plus({ days: 1 });
  return { start, end };
}

function minutesBetween(start, end) {
  if (!start || !end || end <= start) return 0;
  return Math.max(0, Math.round(end.diff(start, 'minutes').minutes));
}

function addOverlapMinutes(target, key, shiftStart, shiftEnd, windowStart, windowEnd) {
  const overlapStart = shiftStart > windowStart ? shiftStart : windowStart;
  const overlapEnd = shiftEnd < windowEnd ? shiftEnd : windowEnd;
  if (overlapEnd > overlapStart) {
    target[key] += minutesBetween(overlapStart, overlapEnd);
  }
}

/**
 * Payroll-oriented bucket helper for GRUAMAN.
 *
 * It classifies the raw worked interval by calendar minute and time band.
 * The source model does not store the exact lunch timestamp or the planned
 * shift type, so these buckets are exposed as explicit band totals rather than
 * inferred entitlements. The legacy `calcularHoras()` output remains the
 * canonical net-hours calculation.
 *
 * @param {{ hora_ingreso: string, hora_salida: string, fecha: string }} params
 * @returns {{ jornada_normal: number, hed: number, hen: number, rn: number, fest: number, rfn: number, hedf: number, henf: number, payroll_total_extras: number }}
 */
function calcularPayrollBucketsGruaman({ hora_ingreso, hora_salida, fecha }) {
  const zone = 'America/Bogota';
  const hhIn = String(hora_ingreso || '').trim();
  const hhOut = String(hora_salida || '').trim();
  if (!hhIn || !hhOut || !fecha) return createZeroPayrollBuckets();

  const dtIngreso = DateTime.fromISO(`${fecha}T${hhIn}`, { zone });
  let dtSalida = DateTime.fromISO(`${fecha}T${hhOut}`, { zone });
  if (!dtIngreso.isValid || !dtSalida.isValid) return createZeroPayrollBuckets();
  if (dtSalida < dtIngreso) dtSalida = dtSalida.plus({ days: 1 });

  const buckets = createZeroPayrollBuckets();
  let currentDay = dtIngreso.startOf('day');
  const lastDay = dtSalida.startOf('day');

  while (currentDay <= lastDay) {
    const dateISO = currentDay.toISODate();
    const dayStart = currentDay;
    const nextDayStart = currentDay.plus({ days: 1 });
    const segmentStart = dtIngreso > dayStart ? dtIngreso : dayStart;
    const segmentEnd = dtSalida < nextDayStart ? dtSalida : nextDayStart;

    if (segmentEnd > segmentStart) {
      const festive = esFestivo(dateISO);
      const jornadaNormalWindow = getWindowInterval(dateISO, 6 * 60, 16 * 60, zone);
      const extraDiurnaWindow = getWindowInterval(dateISO, 16 * 60, 19 * 60, zone);
      const nocheWindow = getWindowInterval(dateISO, 19 * 60, 6 * 60, zone);
      const festivoDiaWindow = getWindowInterval(dateISO, 6 * 60, 19 * 60, zone);

      if (festive) {
        buckets.fest += minutesBetween(segmentStart, segmentEnd);
        addOverlapMinutes(buckets, 'hedf', segmentStart, segmentEnd, festivoDiaWindow.start, festivoDiaWindow.end);
        addOverlapMinutes(buckets, 'henf', segmentStart, segmentEnd, nocheWindow.start, nocheWindow.end);
        addOverlapMinutes(buckets, 'rfn', segmentStart, segmentEnd, nocheWindow.start, nocheWindow.end);
      } else {
        addOverlapMinutes(buckets, 'jornada_normal', segmentStart, segmentEnd, jornadaNormalWindow.start, jornadaNormalWindow.end);
        addOverlapMinutes(buckets, 'hed', segmentStart, segmentEnd, extraDiurnaWindow.start, extraDiurnaWindow.end);
        addOverlapMinutes(buckets, 'hen', segmentStart, segmentEnd, nocheWindow.start, nocheWindow.end);
        addOverlapMinutes(buckets, 'rn', segmentStart, segmentEnd, nocheWindow.start, nocheWindow.end);
      }
    }

    currentDay = currentDay.plus({ days: 1 });
  }

  return {
    jornada_normal: minutesToHours(buckets.jornada_normal),
    hed: minutesToHours(buckets.hed),
    hen: minutesToHours(buckets.hen),
    rn: minutesToHours(buckets.rn),
    fest: minutesToHours(buckets.fest),
    rfn: minutesToHours(buckets.rfn),
    hedf: minutesToHours(buckets.hedf),
    henf: minutesToHours(buckets.henf),
    payroll_total_extras: minutesToHours(buckets.hed + buckets.hen + buckets.hedf + buckets.henf)
  };
}

function getHorasExtraReportConfig(profile = 'gruaman') {
  const isGruaman = profile === 'gruaman';

  const summaryColumns = isGruaman
    ? [
        { label: 'Nombre Operador', key: 'Nombre Operador', width: 145 },
        { label: 'Rol', key: 'Rol', width: 110 },
        { label: 'Días Trabajados', key: 'Días Trabajados', width: 60, align: 'center' },
        { label: 'Horas Trabajadas', key: 'Horas Trabajadas', width: 70, align: 'center' },
        { label: 'Jornada Normal', key: 'Jornada Normal', width: 70, align: 'center' },
        { label: 'H.E.D', key: 'H.E.D', width: 48, align: 'center' },
        { label: 'H.E.N', key: 'H.E.N', width: 48, align: 'center' },
        { label: 'R.N', key: 'R.N', width: 48, align: 'center' },
        { label: 'FEST', key: 'FEST', width: 48, align: 'center' },
        { label: 'R.F.N', key: 'R.F.N', width: 48, align: 'center' },
        { label: 'H.E.D.F', key: 'H.E.D.F', width: 52, align: 'center' },
        { label: 'H.E.N.F', key: 'H.E.N.F', width: 52, align: 'center' },
        { label: 'Total Extras', key: 'Total Extras', width: 72, align: 'center' }
      ]
    : [
        { label: 'Nombre Operador', key: 'Nombre Operador', width: 160 },
        { label: 'Rol', key: 'Rol', width: 120 },
        { label: 'Días Trabajados', key: 'Días Trabajados', width: 72, align: 'center' },
        { label: 'Horas Trabajadas', key: 'Horas Trabajadas', width: 82, align: 'center' },
        { label: 'Extra Diurna', key: 'Extra Diurna', width: 80, align: 'center' },
        { label: 'Extra Nocturna', key: 'Extra Nocturna', width: 80, align: 'center' }
      ];

  const detailColumns = isGruaman
    ? [
        { label: 'Nombre Operador', key: 'Nombre Operador', width: 68 },
        { label: 'Fecha Servicio', key: 'Fecha Servicio', width: 48, align: 'center' },
        { label: 'Tipo de Evento', key: 'Tipo de Evento', width: 58 },
        { label: 'Hora Evento', key: 'Hora Evento', width: 46, align: 'center' },
        { label: 'Hora Ingreso', key: 'Hora Ingreso', width: 46, align: 'center' },
        { label: 'Hora Salida', key: 'Hora Salida', width: 46, align: 'center' },
        { label: 'Horas Trabajadas', key: 'Horas Trabajadas', width: 48, align: 'center' },
        { label: 'Jornada Normal', key: 'Jornada Normal', width: 48, align: 'center' },
        { label: 'H.E.D', key: 'H.E.D', width: 42, align: 'center' },
        { label: 'H.E.N', key: 'H.E.N', width: 42, align: 'center' },
        { label: 'R.N', key: 'R.N', width: 42, align: 'center' },
        { label: 'FEST', key: 'FEST', width: 42, align: 'center' },
        { label: 'R.F.N', key: 'R.F.N', width: 42, align: 'center' },
        { label: 'H.E.D.F', key: 'H.E.D.F', width: 46, align: 'center' },
        { label: 'H.E.N.F', key: 'H.E.N.F', width: 46, align: 'center' },
        { label: 'Rol', key: 'Rol', width: 54 },
        { label: 'Mensaje Auditoría', key: 'Mensaje Auditoría', width: 108 },
        { label: 'Distancia Metros', key: 'Distancia Metros', width: 48, align: 'center' },
        { label: 'Dentro de Rango', key: 'Dentro de Rango', width: 42, align: 'center' },
        { label: 'URL Google Maps', key: 'URL Google Maps', width: 122 }
      ]
    : [
        { label: 'Nombre Operador', key: 'Nombre Operador', width: 78 },
        { label: 'Fecha Servicio', key: 'Fecha Servicio', width: 52, align: 'center' },
        { label: 'Tipo de Evento', key: 'Tipo de Evento', width: 70 },
        { label: 'Hora Ingreso', key: 'Hora Ingreso', width: 48, align: 'center' },
        { label: 'Hora Salida', key: 'Hora Salida', width: 48, align: 'center' },
        { label: 'Horas Trabajadas', key: 'Horas Trabajadas', width: 50, align: 'center' },
        { label: 'Extra Diurna', key: 'Extra Diurna', width: 48, align: 'center' },
        { label: 'Extra Nocturna', key: 'Extra Nocturna', width: 48, align: 'center' },
        { label: 'Rol', key: 'Rol', width: 60 },
        { label: 'Mensaje Auditoría', key: 'Mensaje Auditoría', width: 120 },
        { label: 'Distancia Metros', key: 'Distancia Metros', width: 50, align: 'center' },
        { label: 'Dentro de Rango', key: 'Dentro de Rango', width: 42, align: 'center' },
        { label: 'URL Google Maps', key: 'URL Google Maps', width: 135 }
      ];

  function buildRowFromColumns(source, columns) {
    return columns.reduce((acc, column) => {
      const rawValue = typeof column.value === 'function'
        ? column.value(source)
        : source?.[column.key];
      acc[column.label] = rawValue ?? '';
      return acc;
    }, {});
  }

  return {
    profile,
    summaryColumns,
    detailColumns,
    buildSummaryRow: (source) => {
      if (isGruaman) {
        return buildRowFromColumns(source, summaryColumns.map((column) => ({
          ...column,
          value: (row) => ({
            'Nombre Operador': row.nombre_operador || '',
            Rol: row.rol || row.cargo || '',
            'Días Trabajados': row.total_dias_trabajados ?? 0,
            'Horas Trabajadas': row.total_horas_trabajadas ?? 0,
            'Jornada Normal': row.jornada_normal ?? 0,
            'H.E.D': row.hed ?? 0,
            'H.E.N': row.hen ?? 0,
            'R.N': row.rn ?? 0,
            FEST: row.fest ?? 0,
            'R.F.N': row.rfn ?? 0,
            'H.E.D.F': row.hedf ?? 0,
            'H.E.N.F': row.henf ?? 0,
            'Total Extras': row.payroll_total_extras ?? 0
          })[column.label]
        })));
      }
      return buildRowFromColumns(source, summaryColumns.map((column) => ({
        ...column,
        value: (row) => ({
          'Nombre Operador': row.nombre_operador || '',
          Rol: row.rol || row.cargo || '',
          'Días Trabajados': row.total_dias_trabajados ?? 0,
          'Horas Trabajadas': row.total_horas_trabajadas ?? 0,
          'Extra Diurna': row.total_extra_diurna ?? 0,
          'Extra Nocturna': row.total_extra_nocturna ?? 0
        })[column.label]
      })));
    },
    buildDetailRow: (source) => {
      if (isGruaman) {
        return buildRowFromColumns(source, detailColumns.map((column) => ({
          ...column,
          value: (row) => ({
            'Nombre Operador': row.nombre_operador || '',
            'Fecha Servicio': row.fecha_servicio || '',
            'Tipo de Evento': row.tipo_evento || '',
            'Hora Evento': row.hora_evento || '',
            'Hora Ingreso': row.hora_ingreso || '',
            'Hora Salida': row.hora_salida || '',
            'Horas Trabajadas': row.horas_trabajadas ?? 0,
            'Jornada Normal': row.jornada_normal ?? 0,
            'H.E.D': row.hed ?? 0,
            'H.E.N': row.hen ?? 0,
            'R.N': row.rn ?? 0,
            FEST: row.fest ?? 0,
            'R.F.N': row.rfn ?? 0,
            'H.E.D.F': row.hedf ?? 0,
            'H.E.N.F': row.henf ?? 0,
            Rol: row.rol || row.empresa || row.empresa_nombre || row.empresa_id || '',
            'Mensaje Auditoría': row.audit_message || (row.row_kind === 'audit_attempt' ? 'Intento de salida fallido' : 'Marcación válida'),
            'Distancia Metros': row.audit_distance_meters == null ? 0 : row.audit_distance_meters,
            'Dentro de Rango': row.audit_within_range == null ? (row.row_kind === 'audit_attempt' ? 'No aplica' : 'Sí') : (row.audit_within_range ? 'Sí' : 'No'),
            'URL Google Maps': row.ubicacion_cierre_url || ''
          })[column.label]
        })));
      }
      return buildRowFromColumns(source, detailColumns.map((column) => ({
        ...column,
        value: (row) => ({
          'Nombre Operador': row.nombre_operador || '',
          'Fecha Servicio': row.fecha_servicio || '',
          'Tipo de Evento': row.tipo_evento || '',
          'Hora Ingreso': row.hora_ingreso || '',
          'Hora Salida': row.hora_salida || '',
          'Horas Trabajadas': row.horas_trabajadas ?? 0,
          'Extra Diurna': row.extra_diurna ?? 0,
          'Extra Nocturna': row.extra_nocturna ?? 0,
          Rol: row.rol || row.empresa || row.empresa_nombre || row.empresa_id || '',
          'Mensaje Auditoría': row.audit_message || (row.row_kind === 'audit_attempt' ? 'Intento de salida fallido' : 'Marcación válida'),
          'Distancia Metros': row.audit_distance_meters == null ? 0 : row.audit_distance_meters,
          'Dentro de Rango': row.audit_within_range == null ? (row.row_kind === 'audit_attempt' ? 'No aplica' : 'Sí') : (row.audit_within_range ? 'Sí' : 'No'),
          'URL Google Maps': row.ubicacion_cierre_url || ''
        })[column.label]
      })));
    }
  };
}

function getAdminReportProfile(req) {
  const user = req?.auth?.user || {};
  const permissions = new Set((user.permissions || []).map((value) => String(value)));
  const roles = new Set((user.roles || []).map((value) => String(value)));
  const adminRole = String(user.adminRole || '').toLowerCase();

  if (adminRole === 'gruaman' || permissions.has('admin:gruaman:*') || permissions.has('admin:gruaman') || roles.has('admin:gruaman')) {
    return 'gruaman';
  }
  if (adminRole === 'bomberman' || permissions.has('admin:bomberman:*') || permissions.has('admin:bomberman') || roles.has('admin:bomberman')) {
    return 'bomberman';
  }
  return 'gruaman';
}

function calculateGruamanPayroll({ hora_ingreso, hora_salida, minutos_almuerzo = 0, fecha }) {
  const zone = 'America/Bogota';
  const hhIn = String(hora_ingreso || '').trim();
  const hhOut = String(hora_salida || '').trim();
  if (!hhIn || !hhOut || !fecha) return null;

  const dtIngreso = DateTime.fromISO(`${fecha}T${hhIn}`, { zone });
  let dtSalida = DateTime.fromISO(`${fecha}T${hhOut}`, { zone });
  if (!dtIngreso.isValid || !dtSalida.isValid) return null;
  if (dtSalida < dtIngreso) dtSalida = dtSalida.plus({ days: 1 });

  const totalMinutes = Math.max(0, Math.round(dtSalida.diff(dtIngreso, 'minutes').minutes) - Number(minutos_almuerzo || 0));
  if (totalMinutes <= 0) {
    return {
      dia_semana: DateTime.fromISO(fecha, { zone }).setLocale('es').toFormat('cccc'),
      festivo: esFestivo(fecha),
      horas_trabajadas: 0,
      jornada_normal_0600_1600: 0,
      hed: 0,
      hen: 0,
      rn: 0,
      fest: 0,
      rfn: 0,
      hedf: 0,
      henf: 0,
      extra_diurna: 0,
      extra_nocturna: 0,
      extra_festiva: 0,
      total_extras: 0,
      total_extras_pago: 0
    };
  }

  const buckets = {
    jornada_normal_0600_1600: 0,
    hed: 0,
    hen: 0,
    rn: 0,
    fest: 0,
    rfn: 0,
    hedf: 0,
    henf: 0
  };

  const endOfShift = dtIngreso.plus({ minutes: totalMinutes });
  let currentDay = dtIngreso.startOf('day');
  const lastDay = endOfShift.startOf('day');

  while (currentDay <= lastDay) {
    const dayISO = currentDay.toISODate();
    const dayStart = currentDay;
    const nextDayStart = currentDay.plus({ days: 1 });
    const segmentStart = dtIngreso > dayStart ? dtIngreso : dayStart;
    const segmentEnd = endOfShift < nextDayStart ? endOfShift : nextDayStart;

    if (segmentEnd > segmentStart) {
      const festive = esFestivo(dayISO);
      const jornadaNormalStart = DateTime.fromISO(`${dayISO}T06:00:00`, { zone });
      const jornadaNormalEnd = DateTime.fromISO(`${dayISO}T16:00:00`, { zone });
      const extraDiurnaStart = jornadaNormalEnd;
      const extraDiurnaEnd = DateTime.fromISO(`${dayISO}T19:00:00`, { zone });
      const nocheStart = extraDiurnaEnd;
      const nocheEnd = DateTime.fromISO(`${dayISO}T06:00:00`, { zone }).plus({ days: 1 });

      const overlapMinutes = (windowStart, windowEnd) => {
        const overlapStart = segmentStart > windowStart ? segmentStart : windowStart;
        const overlapEnd = segmentEnd < windowEnd ? segmentEnd : windowEnd;
        return overlapEnd > overlapStart ? Math.max(0, Math.round(overlapEnd.diff(overlapStart, 'minutes').minutes)) : 0;
      };

      if (festive) {
        buckets.fest += Math.max(0, Math.round(segmentEnd.diff(segmentStart, 'minutes').minutes));
        buckets.hedf += overlapMinutes(jornadaNormalStart, extraDiurnaEnd);
        buckets.henf += overlapMinutes(nocheStart, nocheEnd);
        buckets.rfn += overlapMinutes(nocheStart, nocheEnd);
      } else {
        buckets.jornada_normal_0600_1600 += overlapMinutes(jornadaNormalStart, jornadaNormalEnd);
        buckets.hed += overlapMinutes(extraDiurnaStart, extraDiurnaEnd);
        buckets.hen += overlapMinutes(nocheStart, nocheEnd);
        buckets.rn += overlapMinutes(nocheStart, nocheEnd);
      }
    }

    currentDay = currentDay.plus({ days: 1 });
  }

  const jornada_normal_0600_1600 = +(buckets.jornada_normal_0600_1600 / 60).toFixed(2);
  const hed = +(buckets.hed / 60).toFixed(2);
  const hen = +(buckets.hen / 60).toFixed(2);
  const rn = +(buckets.rn / 60).toFixed(2);
  const fest = +(buckets.fest / 60).toFixed(2);
  const rfn = +(buckets.rfn / 60).toFixed(2);
  const hedf = +(buckets.hedf / 60).toFixed(2);
  const henf = +(buckets.henf / 60).toFixed(2);
  const total_extras_pago = +(hed + hen + hedf + henf).toFixed(2);
  const horas_trabajadas = +(totalMinutes / 60).toFixed(2);
  const diaSemana = DateTime.fromISO(fecha, { zone }).setLocale('es').toFormat('cccc');

  return {
    dia_semana: diaSemana,
    festivo: esFestivo(fecha),
    horas_trabajadas,
    jornada_normal_0600_1600,
    hed,
    hen,
    rn,
    fest,
    rfn,
    hedf,
    henf,
    extra_diurna: hed,
    extra_nocturna: hen,
    extra_festiva: +(hedf + henf).toFixed(2),
    total_extras: total_extras_pago,
    total_extras_pago
  };
}

function calculateReportMetrics(profileKey, params) {
  const normalizedProfile = normalizeAdminHorasExtraProfile(profileKey);
  if (normalizedProfile === 'gruas') {
    return calculateGruamanPayroll(params);
  }
  return calcularHoras(params);
}

function getPdfPageMetrics(doc) {
  return {
    width: doc.page.width,
    height: doc.page.height,
    left: 20,
    right: 20,
    top: 18,
    bottom: 18
  };
}

function drawCoverLogoCard(doc, { x, y, width, height, label, assetPath, showLabel = false }) {
  doc.save();
  doc.roundedRect(x, y, width, height, 14)

  if (assetPath) {
    doc.image(assetPath, x + 12, y + 12, {
      fit: [width - 24, showLabel ? height - 48 : height - 24],
      align: 'center',
      valign: 'center'
    });
  } else {
    doc.fillColor('white')
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(label, x + 10, y + 26, {
        width: width - 20,
        align: 'center'
      });
  }

  if (showLabel) {
    doc.fillColor('white')
      .font('Helvetica-Bold')
      .fontSize(11)
      .text(label, x + 8, y + height - 28, {
        width: width - 16,
        align: 'center'
      });
  }
  doc.restore();
}

function drawReportCoverPage(doc, { sectionLabel, title, subtitle, periodLabel }) {
  doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
  const { width, height } = doc.page;

  doc.save();
  doc.rect(0, 0, width, height).fill('#0f4c81');
  doc.restore();

  doc.fillColor('white')
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('REPORTE DE HORAS EXTRA', 0, 44, {
      width,
      align: 'center'
    });

  doc.fillColor('white')
    .font('Helvetica-Bold')
    .fontSize(28)
    .text(sectionLabel, 0, 96, {
      width,
      align: 'center'
    });

  doc.fillColor('white')
    .font('Helvetica')
    .fontSize(13)
    .text(title, 0, 138, {
      width,
      align: 'center'
    });

  if (subtitle) {
    doc.fontSize(10).text(subtitle, 0, 164, {
      width,
      align: 'center'
    });
  }

  if (periodLabel) {
    doc.font('Helvetica-Bold')
      .fontSize(11)
      .text(periodLabel, 0, 188, {
        width,
        align: 'center'
      });
  }

  const assets = REPORT_BRAND_ASSETS.map((asset) => ({
    ...asset,
    path: resolveReportAssetPath(asset.file)
  }));

  const central = assets.find((asset) => asset.label === 'Central');
  const heroes = assets.filter((asset) => asset.label !== 'Central');

  drawCoverLogoCard(doc, {
    x: (width - 240) / 2,
    y: 226,
    width: 240,
    height: 108,
    label: central?.label || 'Central',
    assetPath: central?.path || null,
    showLabel: false
  });

  const heroWidth = 150;
  const heroHeight = 150;
  const heroGap = 18;
  const heroTotalWidth = (heroes.length * heroWidth) + ((heroes.length - 1) * heroGap);
  let heroX = (width - heroTotalWidth) / 2;
  const heroY = 348;

  for (const asset of heroes) {
    drawCoverLogoCard(doc, {
      x: heroX,
      y: heroY,
      width: heroWidth,
      height: heroHeight,
      label: asset.label,
      assetPath: asset.path,
      showLabel: false
    });
    heroX += heroWidth + heroGap;
  }
}

function getPdfColumnValue(row, column) {
  if (!column) return '';
  if (typeof column.value === 'function') return column.value(row);
  if (typeof column.accessor === 'function') return column.accessor(row);
  if (column.key) return row?.[column.key];
  return '';
}

function drawLandscapeTableSection(doc, {
  sectionTitle,
  subtitle,
  note,
  columns,
  rows,
  emptyMessage = 'No hay registros para mostrar.',
  rowStyleResolver = null
}) {
  let metrics = getPdfPageMetrics(doc);
  let tableLeft = metrics.left;
  let tableWidth = metrics.width - metrics.left - metrics.right;
  const headerHeight = 22;
  const rowHeight = 19;
  const rowPaddingX = 4;
  const rowPaddingY = 4;

  const drawPageHeader = () => {
    doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
    const pageMetrics = getPdfPageMetrics(doc);
    metrics = pageMetrics;
    tableLeft = pageMetrics.left;
    tableWidth = pageMetrics.width - pageMetrics.left - pageMetrics.right;
    doc.save();
    doc.rect(0, 0, pageMetrics.width, 10).fill('#0f4c81');
    doc.restore();

    doc.fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(16)
      .text(sectionTitle, pageMetrics.left, 18, {
        width: pageMetrics.width - pageMetrics.left - pageMetrics.right,
        align: 'left'
      });

    if (subtitle) {
      doc.fillColor('#475569')
        .font('Helvetica')
        .fontSize(9)
        .text(subtitle, pageMetrics.left, 40, {
          width: pageMetrics.width - pageMetrics.left - pageMetrics.right,
          align: 'left'
        });
    }

    if (note) {
      doc.fillColor('#64748b')
        .font('Helvetica')
        .fontSize(8)
        .text(note, pageMetrics.left, 54, {
          width: pageMetrics.width - pageMetrics.left - pageMetrics.right,
          align: 'left'
        });
    }

    return 74;
  };

  const drawHeaderRow = (y) => {
    let x = tableLeft;
    doc.font('Helvetica-Bold').fontSize(7.5);

    for (const column of columns) {
      doc.save();
      doc.rect(x, y, column.width, headerHeight).fillAndStroke('#dbeafe', '#94a3b8');
      doc.fillColor('#0f172a').text(column.label, x + 3, y + 5, {
        width: column.width - 6,
        align: 'center',
        ellipsis: true
      });
      doc.restore();
      x += column.width;
    }

    return y + headerHeight;
  };

  const drawRow = (row, y, rowIndex) => {
    let x = tableLeft;
    const rowStyle = typeof rowStyleResolver === 'function' ? rowStyleResolver(row, rowIndex) : null;
    const fill = rowStyle?.fill || (rowIndex % 2 === 0 ? '#ffffff' : '#f8fafc');
    const stroke = rowStyle?.stroke || '#cbd5e1';
    const textColor = rowStyle?.textColor || '#111827';

    for (const column of columns) {
      const value = safeReportText(getPdfColumnValue(row, column));
      doc.save();
      doc.rect(x, y, column.width, rowHeight).fillAndStroke(fill, stroke);
      doc.fillColor(textColor).font('Helvetica').fontSize(6.4).text(value, x + rowPaddingX, y + rowPaddingY, {
        width: column.width - (rowPaddingX * 2),
        height: rowHeight - (rowPaddingY * 2),
        align: column.align || 'left',
        ellipsis: true
      });
      doc.restore();
      x += column.width;
    }
  };

  let y = drawPageHeader();
  y = drawHeaderRow(y);

  if (!rows || rows.length === 0) {
    doc.fillColor('#64748b')
      .font('Helvetica')
      .fontSize(10)
      .text(emptyMessage, tableLeft, y + 18, {
        width: tableWidth,
        align: 'center'
      });
    return;
  }

  rows.forEach((row, index) => {
    if (y + rowHeight > metrics.height - metrics.bottom) {
      y = drawPageHeader();
      y = drawHeaderRow(y);
    }
    drawRow(row, y, index);
    y += rowHeight;
  });
}

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
 * Festivos colombianos móviles por año (Ley Emiliani â€” trasladados al lunes siguiente).
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

function getReportDailyWorkHours() {
  const raw = Number(process.env.REPORT_JORNADA_DIARIA_HORAS ?? process.env.HORAS_JORNADA_DIARIA ?? 7.33);
  return Number.isFinite(raw) && raw > 0 ? raw : 7.33;
}

function getReportLunchWindowHours() {
  return {
    minHours: Number(process.env.REPORT_ALMUERZO_MIN_HOURS ?? 4),
    fullHours: Number(process.env.REPORT_ALMUERZO_FULL_HOURS ?? 5),
    lunchMinutes: Number(process.env.REPORT_ALMUERZO_MINUTES ?? 60)
  };
}

function getReportLunchDeductionMinutes(totalWorkedMinutes) {
  const { minHours, fullHours, lunchMinutes } = getReportLunchWindowHours();
  const workedHours = Number(totalWorkedMinutes || 0) / 60;
  if (!Number.isFinite(workedHours) || workedHours <= 0) return 0;
  if (workedHours <= minHours) return 0;
  if (workedHours >= fullHours) return Math.max(0, Math.round(lunchMinutes));
  const span = Math.max(0.01, fullHours - minHours);
  const ratio = (workedHours - minHours) / span;
  return Math.max(0, Math.round(lunchMinutes * ratio));
}

function buildReportTimeWindow({ fecha, hora_ingreso, hora_salida }) {
  const zone = "America/Bogota";
  const hhIn = String(hora_ingreso || "").trim();
  const hhOut = String(hora_salida || "").trim();
  if (!fecha || !hhIn) return null;

  const dtIngreso = DateTime.fromISO(`${fecha}T${hhIn}`, { zone });
  if (!dtIngreso.isValid) return null;

  let dtSalida;
  let syntheticExit = false;
  if (hhOut) {
    dtSalida = DateTime.fromISO(`${fecha}T${hhOut}`, { zone });
    if (!dtSalida.isValid) return null;
    if (dtSalida < dtIngreso) dtSalida = dtSalida.plus({ days: 1 });
  } else {
    dtSalida = dtIngreso.plus({ hours: getReportDailyWorkHours() });
    syntheticExit = true;
  }

  return { dtIngreso, dtSalida, syntheticExit };
}

/**
 * Calcula las horas trabajadas y el desglose de horas extras para un registro de jornada.
 * La jornada base para extras se toma desde entorno (`HORAS_JORNADA_DIARIA`, por defecto 7.33).
 * El descuento de almuerzo se aplica dinámicamente:
 * - <= 4 horas: no descuenta
 * - >= 5 horas: descuenta 60 minutos
 * - entre 4 y 5 horas: descuenta proporcionalmente
 * @param {{ hora_ingreso: string, hora_salida: string, fecha: string, aplicar_descuento_almuerzo?: boolean }} params
 * @returns {{ dia_semana: string, festivo: boolean, horas_trabajadas: number, extra_diurna: number, extra_nocturna: number, extra_festiva: number, total_extras: number }|null}
 */
function calcularHoras({ hora_ingreso, hora_salida, fecha, aplicar_descuento_almuerzo = true }) {
  const zone = "America/Bogota";
  const window = buildReportTimeWindow({ fecha, hora_ingreso, hora_salida });
  if (!window) return null;

  const { dtIngreso, dtSalida } = window;
  const workedMinutesRaw = Math.max(0, Math.round(dtSalida.diff(dtIngreso, "minutes").minutes));
  const lunchDeduction = aplicar_descuento_almuerzo ? getReportLunchDeductionMinutes(workedMinutesRaw) : 0;
  const minutosTotales = Math.max(0, workedMinutesRaw - lunchDeduction);
  const horasTrabajadas = +(minutosTotales / 60).toFixed(2);

  const jornadaBaseMin = Math.max(1, Math.round(getReportDailyWorkHours() * 60));
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

/**
 * Calcula la duración bruta de un registro en minutos, sin descuento de almuerzo.
 * @param {{ hora_ingreso: string, hora_salida: string, fecha: string }} params
 * @returns {number}
 */
function calcularMinutosRegistro({ hora_ingreso, hora_salida, hora_salida_calculada, fecha }) {
  const zone = "America/Bogota";
  const hhIn = String(hora_ingreso || "").trim();
  const hhOut = String(hora_salida || hora_salida_calculada || "").trim();
  if (!hhIn || !fecha || !hhOut) return 0;

  const dtIngreso = DateTime.fromISO(`${fecha}T${hhIn}`, { zone });
  let dtSalida = DateTime.fromISO(`${fecha}T${hhOut}`, { zone });
  if (!dtIngreso.isValid || !dtSalida.isValid) return 0;
  if (dtSalida < dtIngreso) dtSalida = dtSalida.plus({ days: 1 });

  return Math.max(0, Math.round(dtSalida.diff(dtIngreso, "minutes").minutes));
}

/**
 * Agrupa jornadas por operador y día para calcular horas trabajadas una sola vez por fecha.
 * El descuento de almuerzo se aplica una única vez por día si hubo al menos un registro vÃ¡lido.
 * @param {Array<object>} rows
 * @returns {Array<{
 *   nombre_operador: string,
 *   fecha: string,
 *   mesAnio: string,
 *   rawMinutes: number,
 *   lunchMinutes: number,
 *   hasValidRow: boolean,
 *   invalidRows: number,
 *   extra_diurna: number,
 *   extra_nocturna: number,
 *   extra_festiva: number,
 *   total_extras: number
 * }>}
 */
function agruparJornadasPorDia(rows) {
  const grupos = new Map();

  for (const r of rows || []) {
    const fecha = formatDateOnly(r.fecha_servicio);
    const mesAnio = fecha ? fecha.slice(0, 7) : 'Sin fecha';
    const operador = r.nombre_operador || 'Sin nombre';
    const key = `${operador}|${fecha}`;

    if (!grupos.has(key)) {
      grupos.set(key, {
        nombre_operador: operador,
        cargo: String(r.cargo || ''),
        empresaId: r.empresa_id ?? null,
        empresaNombre: String(r.empresa || '').trim(),
        fecha,
        mesAnio,
        rawMinutes: 0,
        lunchMinutes: 0,
        hasValidRow: false,
        invalidRows: 0,
        rows: [],
        extra_diurna: 0,
        extra_nocturna: 0,
        extra_festiva: 0,
        total_extras: 0
      });
    }

    const grupo = grupos.get(key);
    if (!grupo.cargo && r.cargo) grupo.cargo = String(r.cargo);
    if (!grupo.empresaId && r.empresa_id != null) grupo.empresaId = r.empresa_id;
    if (!grupo.empresaNombre && r.empresa) grupo.empresaNombre = String(r.empresa).trim();
    const tieneHorasCompletas = Boolean(r.hora_ingreso && r.hora_salida);
    if (!tieneHorasCompletas) {
      grupo.invalidRows += 1;
      continue;
    }

    const rawMinutes = calcularMinutosRegistro({ hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida, fecha });
    const calculosSinAlmuerzo = calcularHoras({
      hora_ingreso: r.hora_ingreso,
      hora_salida: r.hora_salida,
      minutos_almuerzo: 0,
      fecha
    }) || { extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0 };

    grupo.rawMinutes += rawMinutes;
    grupo.lunchMinutes = Math.max(grupo.lunchMinutes, Number(r.minutos_almuerzo || 0));
    grupo.hasValidRow = true;
    grupo.rows.push({
      hora_ingreso: r.hora_ingreso,
      hora_salida: r.hora_salida,
      minutos_almuerzo: 0,
      fecha_servicio: r.fecha_servicio,
      fecha
    });
    grupo.extra_diurna += calculosSinAlmuerzo.extra_diurna || 0;
    grupo.extra_nocturna += calculosSinAlmuerzo.extra_nocturna || 0;
    grupo.extra_festiva += calculosSinAlmuerzo.extra_festiva || 0;
    grupo.total_extras += calculosSinAlmuerzo.total_extras || 0;
  }

  return Array.from(grupos.values());
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
      doc.text(`Tipo de evento: ${r.tipo_evento || ''}`);
      doc.text(`Cliente: ${r.nombre_cliente || ''}`);
      doc.text(`Proyecto: ${r.nombre_proyecto || ''}`);
      doc.text(`Operador: ${r.nombre_operador || ''}`);
      doc.text(`Cargo: ${r.cargo || ''}`);
      doc.text(`Rol: ${r.rol || r.empresa_nombre || r.empresa || r.empresa_id || ''}`);
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
      doc.text(`Mensaje auditoría: ${r.audit_message || (r.row_kind === 'audit_attempt' ? 'Intento de salida fallido' : 'Marcación válida')}`);
      doc.text(`Distancia metros: ${r.audit_distance_meters == null ? 0 : r.audit_distance_meters}`);
      doc.text(`Dentro de rango: ${r.audit_within_range == null ? (r.row_kind === 'audit_attempt' ? 'No aplica' : 'Sí') : (r.audit_within_range ? 'Sí' : 'No')}`);
      if (r.ubicacion_cierre_url) doc.text(`URL Google Maps: ${r.ubicacion_cierre_url}`);
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
      doc.moveDown(0.25);
      doc.fontSize(9).text('Nota: el descuento de almuerzo se aplica una sola vez por día con al menos una marcación válida.', { align: 'center' });
      doc.moveDown(1.5);

      const tableTop = doc.y;
      const colWidths = [180, 85, 85, 75, 75, 75, 75];
      const headers = ['Nombre Operador', 'Días', 'Horas Trabajadas', 'Extra Diurna', 'Extra Nocturna', 'Extra Festiva', 'Total Extras'];

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
 * Genera un PDF A4 apaisado con el resumen de un Ãºnico mes calendario.
 * @param {Array<object>} resumenUsuarios - Totales por operador para el mes.
 * @param {{ horas_trabajadas: number, extra_diurna: number, extra_nocturna: number, extra_festiva: number, total_extras: number }} totalMes
 * @param {string} nombreMes - Nombre legible del mes (ej. "Enero").
 * @param {string} anio - Cadena del año en cuatro dÃ­gitos.
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
      doc.moveDown(0.25);
      doc.fontSize(9).text('Nota: el descuento de almuerzo se aplica una sola vez por día con al menos una marcación válida.', { align: 'center' });
      doc.moveDown(1.5);

      const tableTop = doc.y;
      const colWidths = [180, 85, 85, 75, 75, 75, 75];
      const headers = ['Nombre Operador', 'Días', 'Horas Trabajadas', 'Extra Diurna', 'Extra Nocturna', 'Extra Festiva', 'Total Extras'];

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
 * Retorna un objeto vacÃ­o si las tablas subyacentes no existen.
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
 * Construye un mapa { [empresa_id]: nombre_empresa } desde la tabla empresas.
 * @param {import('pg').Pool} pool
 * @returns {Promise<Record<string, string>>}
 */
async function buildEmpresaMap(pool) {
  const empresaMap = {};
  try {
    const q = await pool.query(`SELECT id, nombre FROM empresas`);
    for (const row of q.rows) {
      if (row?.id != null) empresaMap[String(row.id)] = String(row.nombre || '').trim();
    }
  } catch (_) { /* la tabla puede no existir en entornos antiguos */ }
  return empresaMap;
}

/**
 * Construye un mapa { [horas_jornada_id]: ubicacion } a partir del último intento de cierre auditado.
 * Si existe una marcación válida, devuelve el nombre de la obra; si no, devuelve un enlace a Google Maps
 * con las coordenadas del intento. Si no hay auditorÃ­a, retorna un objeto vacÃ­o para ese id.
 * @param {import('pg').Pool} pool
 * @param {Array<number>} jornadaIds
 * @returns {Promise<Record<number, { display: string, mapsUrl: string|null, action: string|null, obraNombre: string|null, latitude: number|null, longitude: number|null }>>}
 */
async function buildCierreLocationMap(pool, jornadaIds) {
  const ids = Array.from(new Set((jornadaIds || []).filter(id => Number.isFinite(Number(id))).map(id => Number(id))));
  const cierreLocationMap = {};
  if (ids.length === 0) return cierreLocationMap;

  try {
    const q = await pool.query(
      `SELECT
         horas_jornada_id,
         obra_nombre,
         latitude,
         longitude,
         action,
         created_at,
         id
       FROM attendance_location_audit_logs
       WHERE horas_jornada_id = ANY($1::int[])
         AND event_type = 'salida_attempt'
       ORDER BY horas_jornada_id, created_at DESC, id DESC`,
      [ids]
    );

    const grouped = new Map();
    for (const row of q.rows) {
      const key = Number(row.horas_jornada_id);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }

    for (const id of ids) {
      const rows = grouped.get(id) || [];
      if (rows.length === 0) continue;

      const allowed = rows.find((row) => row.action === "allowed");
      const chosen = allowed || rows[0];
      const obraNombre = String(chosen.obra_nombre || "").trim();
      const latitude = toFiniteCoordinate(chosen.latitude);
      const longitude = toFiniteCoordinate(chosen.longitude);
      const mapsUrl = latitude != null && longitude != null
        ? `https://www.google.com/maps?q=${latitude},${longitude}`
        : null;
      const display = chosen.action === "allowed"
        ? (obraNombre || mapsUrl || "Ubicación validada")
        : (mapsUrl || obraNombre || "Ubicación inválida");

      cierreLocationMap[id] = {
        display,
        mapsUrl,
        action: chosen.action || null,
        obraNombre: obraNombre || null,
        latitude,
        longitude
      };
    }
  } catch (_) { /* la tabla de auditorÃ­a puede no existir en entornos antiguos */ }

  return cierreLocationMap;
}

function buildGoogleMapsUrl(latitude, longitude) {
  const lat = toFiniteCoordinate(latitude);
  const lon = toFiniteCoordinate(longitude);
  if (lat == null || lon == null) return null;
  return `https://www.google.com/maps?q=${lat},${lon}`;
}

function formatBogotaTime(value) {
  if (!value) return '';
  const dt = value instanceof Date
    ? DateTime.fromJSDate(value, { zone: 'utc' }).setZone('America/Bogota')
    : DateTime.fromISO(String(value), { zone: 'utc' }).setZone('America/Bogota');
  return dt.isValid ? dt.toFormat('HH:mm:ss') : '';
}

function sortReportRows(rows) {
  return rows.sort((a, b) => {
    const aDate = String(a.fecha_servicio || '');
    const bDate = String(b.fecha_servicio || '');
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    const aName = String(a.nombre_operador || '');
    const bName = String(b.nombre_operador || '');
    if (aName !== bName) return aName.localeCompare(bName);
    const aSort = String(a.sort_key || '');
    const bSort = String(b.sort_key || '');
    return aSort.localeCompare(bSort);
  });
}

const PAYMENT_BREAKDOWN_KEYS = [
  'jornada_normal_0600_1600',
  'hed',
  'hen',
  'rn',
  'fest',
  'rfn',
  'hedf',
  'henf',
  'total_extras_pago'
];

const ADMIN_HORAS_EXTRA_REPORT_PROFILES = {
  gruas: {
    key: 'gruas',
    permissionPrefix: 'admin:gruaman:',
    displayName: 'gruas',
    summaryNote: 'Jornada normal 06:00-16:00. Los rubros se calculan por franjas horarias; como el modelo no guarda turno planificado ni pausa exacta, R.N, FEST y R.F.N se exponen como bandas explícitas y pueden superponerse con el desglose nocturno/festivo.',
    detailNote: 'El desglose de pago se calcula desde hora_ingreso, hora_salida y la fecha del registro. La pausa de almuerzo no se distribuye por franja porque no se almacena su timestamp.',
    pdfSummaryColumns: [
      { label: 'Nombre Operador', key: 'nombre_operador', width: 118 },
      { label: 'Rol', key: 'rol', width: 84 },
      { label: 'Días Trabajados', key: 'total_dias_trabajados', width: 48, align: 'center' },
      { label: 'Horas Trabajadas', key: 'total_horas_trabajadas', width: 52, align: 'center' },
      { label: 'Jornada Normal 06:00-16:00', key: 'jornada_normal_0600_1600', width: 64, align: 'center' },
      { label: 'H.E.D', key: 'hed', width: 40, align: 'center' },
      { label: 'H.E.N', key: 'hen', width: 40, align: 'center' },
      { label: 'R.N', key: 'rn', width: 36, align: 'center' },
      { label: 'FEST', key: 'fest', width: 40, align: 'center' },
      { label: 'R.F.N', key: 'rfn', width: 40, align: 'center' },
      { label: 'H.E.D.F', key: 'hedf', width: 44, align: 'center' },
      { label: 'H.E.N.F', key: 'henf', width: 44, align: 'center' },
      { label: 'Total Extras', key: 'total_extras_pago', width: 52, align: 'center' }
    ],
    pdfDetailColumns: [
      { label: 'Nombre Operador', key: 'Nombre Operador', width: 70 },
      { label: 'Fecha Servicio', key: 'Fecha Servicio', width: 50, align: 'center' },
      { label: 'Tipo de Evento', key: 'Tipo de Evento', width: 68 },
      { label: 'Desglose Pago', key: 'Desglose Pago', width: 118 },
      { label: 'Hora Ingreso', key: 'Hora Ingreso', width: 46, align: 'center' },
      { label: 'Hora Salida', key: 'Hora Salida', width: 46, align: 'center' },
      { label: 'Horas Trabajadas', key: 'Horas Trabajadas', width: 48, align: 'center' },
      { label: 'Rol', key: 'Rol', width: 54 },
      { label: 'Mensaje Auditoría', key: 'Mensaje Auditoría', width: 96 },
      { label: 'Distancia Metros', key: 'Distancia Metros', width: 44, align: 'center' },
      { label: 'Dentro de Rango', key: 'Dentro de Rango', width: 42, align: 'center' },
      { label: 'URL Google Maps', key: 'URL Google Maps', width: 110 }
    ],
    sheetSummaryColumns: [
      { label: 'Nombre Operador', key: 'nombre_operador' },
      { label: 'Rol', key: 'rol' },
      { label: 'Días Trabajados', key: 'total_dias_trabajados' },
      { label: 'Horas Trabajadas', key: 'total_horas_trabajadas' },
      { label: 'Jornada Normal 06:00-16:00', key: 'jornada_normal_0600_1600' },
      { label: 'H.E.D', key: 'hed' },
      { label: 'H.E.N', key: 'hen' },
      { label: 'R.N', key: 'rn' },
      { label: 'FEST', key: 'fest' },
      { label: 'R.F.N', key: 'rfn' },
      { label: 'H.E.D.F', key: 'hedf' },
      { label: 'H.E.N.F', key: 'henf' },
      { label: 'Total Extras', key: 'total_extras_pago' }
    ],
    sheetDetailColumns: [
      { label: 'Nombre Operador', key: 'Nombre Operador' },
      { label: 'Fecha Servicio', key: 'Fecha Servicio' },
      { label: 'Tipo de Evento', key: 'Tipo de Evento' },
      { label: 'Hora Evento', key: 'Hora Evento' },
      { label: 'Hora Ingreso', key: 'Hora Ingreso' },
      { label: 'Hora Salida', key: 'Hora Salida' },
      { label: 'Horas Trabajadas', key: 'Horas Trabajadas' },
      { label: 'Rol', key: 'Rol' },
      { label: 'Mensaje Auditoría', key: 'Mensaje Auditoría' },
      { label: 'Distancia Metros', key: 'Distancia Metros' },
      { label: 'Dentro de Rango', key: 'Dentro de Rango' },
      { label: 'URL Google Maps', key: 'URL Google Maps' },
      { label: 'Jornada Normal 06:00-16:00', key: 'Jornada Normal 06:00-16:00' },
      { label: 'H.E.D', key: 'H.E.D' },
      { label: 'H.E.N', key: 'H.E.N' },
      { label: 'R.N', key: 'R.N' },
      { label: 'FEST', key: 'FEST' },
      { label: 'R.F.N', key: 'R.F.N' },
      { label: 'H.E.D.F', key: 'H.E.D.F' },
      { label: 'H.E.N.F', key: 'H.E.N.F' },
      { label: 'Total Extras', key: 'Total Extras' },
      { label: 'Desglose Pago', key: 'Desglose Pago' }
    ]
  },
  bombas: {
    key: 'bombas',
    permissionPrefix: 'admin:bomberman:',
    displayName: 'bombas',
    summaryNote: 'El resumen muestra horas brutas, descuento de almuerzo acumulado y horas netas. El descuento se aplica una sola vez por día, no una vez por mes.',
    detailNote: 'El detalle es evento por evento y muestra la duración bruta de cada bloque. Las filas inválidas se destacan visualmente y el neto se consolida solo en el resumen diario.',
    pdfSummaryColumns: [
      { label: 'Nombre Operador', key: 'nombre_operador', width: 150 },
      { label: 'Rol', key: 'rol', width: 120 },
      { label: 'Días Trabajados', key: 'total_dias_trabajados', width: 72, align: 'center' },
      { label: 'Horas Totales', key: 'total_horas_brutas', width: 78, align: 'center' },
      { label: 'Descuento Almuerzo', key: 'total_descuento_almuerzo', width: 86, align: 'center' },
      { label: 'Horas Trabajadas', key: 'total_horas_trabajadas', width: 82, align: 'center' },
      { label: 'Extra Diurna', key: 'total_extra_diurna', width: 76, align: 'center' },
      { label: 'Extra Nocturna', key: 'total_extra_nocturna', width: 78, align: 'center' }
    ],
    pdfDetailColumns: [
      { label: 'Nombre Operador', key: 'Nombre Operador', width: 78 },
      { label: 'Fecha Servicio', key: 'Fecha Servicio', width: 52, align: 'center' },
      { label: 'Hora Ingreso', key: 'Hora Ingreso', width: 48, align: 'center' },
      { label: 'Hora Salida', key: 'Hora Salida', width: 48, align: 'center' },
      { label: 'Horas Trabajadas', key: 'Horas Trabajadas', width: 50, align: 'center' },
      { label: 'Extra Diurna', key: 'Extra Diurna', width: 50, align: 'center' },
      { label: 'Extra Nocturna', key: 'Extra Nocturna', width: 50, align: 'center' },
      { label: 'Festivo', key: 'Festivo', width: 42, align: 'center' },
      { label: 'Cliente', key: 'Cliente', width: 70 },
      { label: 'Proyecto', key: 'Proyecto', width: 70 },
      { label: 'Sede', key: 'Sede', width: 68 },
      { label: 'Rol', key: 'Rol', width: 60 },
      { label: 'Tipo de Evento', key: 'Tipo de Evento', width: 70 }
    ],
    sheetSummaryColumns: [
      { label: 'Nombre Operador', key: 'nombre_operador' },
      { label: 'Rol', key: 'rol' },
      { label: 'Días Trabajados', key: 'total_dias_trabajados' },
      { label: 'Horas Totales', key: 'total_horas_brutas' },
      { label: 'Descuento Almuerzo', key: 'total_descuento_almuerzo' },
      { label: 'Horas Trabajadas', key: 'total_horas_trabajadas' },
      { label: 'Extra Diurna', key: 'total_extra_diurna' },
      { label: 'Extra Nocturna', key: 'total_extra_nocturna' }
    ],
    sheetDetailColumns: [
      { label: 'Nombre Operador', key: 'Nombre Operador' },
      { label: 'Fecha Servicio', key: 'Fecha Servicio' },
      { label: 'Hora Ingreso', key: 'Hora Ingreso' },
      { label: 'Hora Salida', key: 'Hora Salida' },
      { label: 'Horas Trabajadas', key: 'Horas Trabajadas' },
      { label: 'Extra Diurna', key: 'Extra Diurna' },
      { label: 'Extra Nocturna', key: 'Extra Nocturna' },
      { label: 'Festivo', key: 'Festivo' },
      { label: 'Cliente', key: 'Cliente' },
      { label: 'Proyecto', key: 'Proyecto' },
      { label: 'Sede', key: 'Sede' },
      { label: 'Rol', key: 'Rol' },
      { label: 'Tipo de Evento', key: 'Tipo de Evento' }
    ]
  }
};

function getReportProfileFromPermissions(permissions = []) {
  const normalizedPermissions = Array.isArray(permissions) ? permissions : [];
  if (normalizedPermissions.some((permission) => String(permission).startsWith('admin:bomberman:'))) {
    return 'bombas';
  }
  if (normalizedPermissions.some((permission) => String(permission).startsWith('admin:gruaman:'))) {
    return 'gruas';
  }
  return 'gruas';
}

function resolveAdminHorasExtraProfile(req) {
  return 'shared';
}

function normalizeAdminHorasExtraProfile(profileKey = 'gruas') {
  const normalized = String(profileKey || '').trim().toLowerCase();
  if (normalized === 'gruaman' || normalized === 'gruas') return 'gruas';
  if (normalized === 'bomberman' || normalized === 'bombas') return 'bombas';
  if (normalized === 'shared' || normalized === 'comun' || normalized === 'común') return 'shared';
  return 'shared';
}

function getReportProfileConfig(profileKey) {
  const profile = ADMIN_HORAS_EXTRA_REPORT_PROFILES.bombas;
  return {
    ...profile,
    key: 'shared',
    permissionPrefix: 'admin:',
    label: 'Reporte de Horas Extra',
    displayName: 'Reporte de Horas Extra',
    summaryNote: '',
    detailNote: 'Detalle evento por evento: las filas muestran duración bruta por bloque y las inválidas se sombrean en PDF y Excel en rojo. El neto después del almuerzo se consolida solo en el resumen diario.',
    pdfSummaryColumns: [
      { label: 'Nombre Operador', key: 'nombre_operador', width: 150 },
      { label: 'Rol', key: 'rol', width: 120 },
      { label: 'Días Trabajados', key: 'total_dias_trabajados', width: 72, align: 'center' },
      { label: 'Horas Brutas', key: 'total_horas_brutas', width: 78, align: 'center' },
      { label: 'Descuento Almuerzo', key: 'total_descuento_almuerzo', width: 86, align: 'center' },
      { label: 'Horas Netas', key: 'total_horas_trabajadas', width: 82, align: 'center' },
      { label: 'Extra Diurna', key: 'total_extra_diurna', width: 76, align: 'center' },
      { label: 'Extra Nocturna', key: 'total_extra_nocturna', width: 78, align: 'center' }
    ],
    sheetSummaryColumns: [
      { label: 'Nombre Operador', key: 'nombre_operador' },
      { label: 'Rol', key: 'rol' },
      { label: 'Días Trabajados', key: 'total_dias_trabajados' },
      { label: 'Horas Brutas', key: 'total_horas_brutas' },
      { label: 'Descuento Almuerzo', key: 'total_descuento_almuerzo' },
      { label: 'Horas Netas', key: 'total_horas_trabajadas' },
      { label: 'Extra Diurna', key: 'total_extra_diurna' },
      { label: 'Extra Nocturna', key: 'total_extra_nocturna' }
    ]
  };
}

function createEmptyPaymentBreakdown() {
  return {
    jornada_normal_0600_1600: 0,
    hed: 0,
    hen: 0,
    rn: 0,
    fest: 0,
    rfn: 0,
    hedf: 0,
    henf: 0,
    total_extras_pago: 0
  };
}

function addPaymentBreakdown(target, source) {
  for (const key of PAYMENT_BREAKDOWN_KEYS) {
    target[key] = +(Number(target[key] || 0) + Number(source?.[key] || 0)).toFixed(2);
  }
  return target;
}

function paymentBreakdownFromLegacy(row) {
  const horasTrabajadas = Number(row?.horas_trabajadas || 0);
  const totalExtras = Number(row?.total_extras || 0);
  return {
    jornada_normal_0600_1600: +(Math.max(0, horasTrabajadas - totalExtras).toFixed(2)),
    hed: +(Number(row?.extra_diurna || 0)).toFixed(2),
    hen: +(Number(row?.extra_nocturna || 0)).toFixed(2),
    rn: 0,
    fest: +(Number(row?.extra_festiva || 0)).toFixed(2),
    rfn: 0,
    hedf: 0,
    henf: 0,
    total_extras_pago: +totalExtras.toFixed(2)
  };
}

function calculatePaymentBreakdown(row, profileKey = 'gruas') {
  if (!row) return createEmptyPaymentBreakdown();
  const fecha = formatDateOnly(row.fecha_servicio || row.fecha);
  const hhIn = String(row.hora_ingreso || '').trim();
  const hhOut = String(row.hora_salida || '').trim();
  if (!fecha || !hhIn || !hhOut) return createEmptyPaymentBreakdown();
  const profileCode = profileKey === 'gruas' ? 'gruaman' : 'bomberman';
  const aplicarDescuentoAlmuerzo = row.aplicar_descuento_almuerzo !== false;
  const metrics = calculateReportMetrics(profileCode, {
    hora_ingreso: hhIn,
    hora_salida: hhOut,
    minutos_almuerzo: Number(row.minutos_almuerzo || 0),
    fecha,
    aplicar_descuento_almuerzo: aplicarDescuentoAlmuerzo
  });

  if (!metrics) return createEmptyPaymentBreakdown();

  const horasTrabajadas = Number(metrics.horas_trabajadas || 0);
  const hed = Number(metrics.hed ?? metrics.extra_diurna ?? 0);
  const hen = Number(metrics.hen ?? metrics.extra_nocturna ?? 0);
  const rn = Number(metrics.rn || 0);
  const fest = Number(metrics.fest || 0);
  const rfn = Number(metrics.rfn || 0);
  const hedf = Number(metrics.hedf || 0);
  const henf = Number(metrics.henf || 0);
  const totalExtras = Number(metrics.total_extras ?? (hed + hen + hedf + henf));

  const jornadaNormal = Math.max(0, horasTrabajadas - hed - hen - rn - fest - rfn - hedf - henf);

  return {
    jornada_normal_0600_1600: +jornadaNormal.toFixed(2),
    hed: +hed.toFixed(2),
    hen: +hen.toFixed(2),
    rn: +rn.toFixed(2),
    fest: +fest.toFixed(2),
    rfn: +rfn.toFixed(2),
    hedf: +hedf.toFixed(2),
    henf: +henf.toFixed(2),
    total_extras_pago: +totalExtras.toFixed(2)
  };
}

function buildPaymentBreakdownLabel(breakdown) {
  const entries = [
    ['Jornada Normal 06:00-16:00', breakdown?.jornada_normal_0600_1600],
    ['H.E.D', breakdown?.hed],
    ['H.E.N', breakdown?.hen],
    ['R.N', breakdown?.rn],
    ['FEST', breakdown?.fest],
    ['R.F.N', breakdown?.rfn],
    ['H.E.D.F', breakdown?.hedf],
    ['H.E.N.F', breakdown?.henf]
  ];

  const parts = entries
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([label, value]) => `${label} ${Number(value || 0).toFixed(2)}`);

  return parts.length > 0 ? parts.join(' | ') : '0.00';
}

function buildRowPaymentBreakdown(row, profileKey = 'gruas') {
  const sourceBreakdown = row?.payment_breakdown || calculatePaymentBreakdown(row, profileKey);
  const breakdown = {
    ...createEmptyPaymentBreakdown(),
    ...sourceBreakdown
  };
  breakdown.desglose_pago = buildPaymentBreakdownLabel(breakdown);
  return breakdown;
}

function buildSpanishDetailRow(row) {
  return {
    "Nombre Operador": row.nombre_operador || '',
    "Fecha Servicio": row.fecha_servicio || '',
    "Tipo de Evento": row.tipo_evento || '',
    "Hora Evento": row.hora_evento || '',
    "Hora Ingreso": row.hora_ingreso || '',
    "Hora Salida": row.hora_salida || '',
    "Horas Trabajadas": row.horas_trabajadas ?? 0,
    "Extra Diurna": row.extra_diurna ?? 0,
    "Extra Nocturna": row.extra_nocturna ?? 0,
    "Extra Festiva": row.extra_festiva ?? 0,
    "Total Extras": row.total_extras ?? 0,
    "Festivo": row.festivo === true ? 'Sí' : row.festivo === false ? 'No' : '',
    "Día Semana": row.dia_semana || '',
    "Cliente": row.nombre_cliente || '',
    "Proyecto": row.nombre_proyecto || '',
    "Cargo": row.cargo || '',
    "Rol": row.rol || row.empresa || row.empresa_nombre || row.empresa_id || '',
    "Mensaje Auditoría": row.audit_message || (row.row_kind === 'audit_attempt' ? 'Intento de salida fallido' : 'Marcación válida'),
    "Distancia Metros": row.audit_distance_meters == null ? 0 : row.audit_distance_meters,
    "Dentro de Rango": row.audit_within_range == null ? (row.row_kind === 'audit_attempt' ? 'No aplica' : 'Sí') : (row.audit_within_range ? 'Sí' : 'No'),
    "URL Google Maps": row.ubicacion_cierre_url || ''
  };
}

function buildSpanishDetailRowByProfile(row, profileKey = 'bomberman') {
  const normalizedProfile = normalizeAdminHorasExtraProfile(profileKey);
  if (normalizedProfile === 'gruas') {
    return {
      "Nombre Operador": row.nombre_operador || '',
      "Fecha Servicio": row.fecha_servicio || '',
      "Tipo de Evento": row.tipo_evento || '',
      "Hora Evento": row.hora_evento || '',
      "Hora Ingreso": row.hora_ingreso || '',
      "Hora Salida": row.hora_salida || '',
      "Horas Trabajadas": row.horas_trabajadas ?? 0,
      "Jornada Normal 06:00-16:00": row.jornada_normal_0600_1600 ?? row.payment_breakdown?.jornada_normal_0600_1600 ?? 0,
      "H.E.D": row.hed ?? row.extra_diurna ?? 0,
      "H.E.N": row.hen ?? row.extra_nocturna ?? 0,
      "R.N": row.rn ?? 0,
      "FEST": row.fest ?? 0,
      "R.F.N": row.rfn ?? 0,
      "H.E.D.F": row.hedf ?? 0,
      "H.E.N.F": row.henf ?? 0,
      "Total Extras": row.total_extras_pago ?? row.payment_breakdown?.total_extras_pago ?? 0,
      "Rol": row.rol || row.empresa || row.empresa_nombre || row.empresa_id || '',
      "Sede": row.sede || row.sede_cierre || '',
      "Mensaje Auditoría": row.audit_message || (row.row_kind === 'audit_attempt' ? 'Intento de salida fallido' : 'Marcación válida'),
      "Distancia Metros": row.audit_distance_meters == null ? 0 : row.audit_distance_meters,
      "Dentro de Rango": row.audit_within_range == null ? (row.row_kind === 'audit_attempt' ? 'No aplica' : 'Sí') : (row.audit_within_range ? 'Sí' : 'No'),
      "URL Google Maps": row.ubicacion_cierre_url || '',
      "Desglose Pago": row.desglose_pago || buildPaymentBreakdownLabel(row.payment_breakdown || buildRowPaymentBreakdown(row, 'gruas'))
    };
  }

  return {
    "Nombre Operador": row.nombre_operador || '',
    "Fecha Servicio": row.fecha_servicio || '',
    "Hora Ingreso": row.hora_ingreso || '',
    "Hora Salida": row.hora_salida || '',
    "Horas Trabajadas": row.horas_trabajadas ?? 0,
    "Extra Diurna": row.extra_diurna ?? 0,
    "Extra Nocturna": row.extra_nocturna ?? 0,
    "Festivo": row.festivo === true ? 'Sí' : row.festivo === false ? 'No' : '',
    "Cliente": row.nombre_cliente || row.cliente || '',
    "Proyecto": row.nombre_proyecto || row.proyecto || '',
    "Sede": row.sede || row.sede_cierre || '',
    "Rol": row.rol || row.empresa || row.empresa_nombre || row.empresa_id || '',
    "Tipo de Evento": row.tipo_evento || '',
    "Mensaje Auditoría": row.audit_message || (row.row_kind === 'audit_attempt' ? 'Intento de salida fallido' : 'Marcación válida'),
    "URL Google Maps": row.ubicacion_cierre_url || ''
  };
}

function buildSummaryReportRowByProfile(row, profileKey = 'bomberman') {
  const normalizedProfile = normalizeAdminHorasExtraProfile(profileKey);
  if (normalizedProfile === 'gruas') {
    return {
      "Nombre Operador": row.nombre_operador || '',
      "Rol": row.rol || row.cargo || '',
      "Días Trabajados": row.total_dias_trabajados ?? 0,
      "Horas Trabajadas": row.total_horas_trabajadas ?? 0,
      "Jornada Normal 06:00-16:00": row.jornada_normal_0600_1600 ?? 0,
      "H.E.D": row.hed ?? 0,
      "H.E.N": row.hen ?? 0,
      "R.N": row.rn ?? 0,
      "FEST": row.fest ?? 0,
      "R.F.N": row.rfn ?? 0,
      "H.E.D.F": row.hedf ?? 0,
      "H.E.N.F": row.henf ?? 0,
      "Total Extras": row.total_extras_pago ?? row.total_horas_extras ?? 0
    };
  }

  return {
    "Nombre Operador": row.nombre_operador || '',
    "Rol": row.rol || row.cargo || '',
    "Días Trabajados": row.total_dias_trabajados ?? 0,
    "Horas Totales": row.total_horas_brutas ?? row.horas_brutas ?? 0,
    "Descuento Almuerzo": row.total_descuento_almuerzo ?? row.descuento_almuerzo ?? 0,
    "Horas Trabajadas": row.total_horas_trabajadas ?? 0,
    "Extra Diurna": row.total_extra_diurna ?? row.extra_diurna ?? 0,
    "Extra Nocturna": row.total_extra_nocturna ?? row.extra_nocturna ?? 0
  };
}

function createPdfJobRequest(req) {
  const body = { ...(req?.body || {}) };
  delete body.modo;
  delete body.mode;
  delete body.async;
  delete body.as_job;
  return {
    auth: req?.auth,
    query: { ...(req?.query || {}) },
    headers: { ...(req?.headers || {}) },
    baseUrl: req?.baseUrl,
    originalUrl: req?.originalUrl,
    body: {
      ...body,
      formato: 'pdf'
    },
    method: 'POST'
  };
}

async function processHorasExtraPdfJob(jobId, req) {
  const job = getReportJob(jobId);
  if (!job) return;

  ensureReportTempDir();
  const filePath = path.join(REPORT_TEMP_DIR, `${jobId}.pdf`);
  const fileStream = fs.createWriteStream(filePath);
  const responseAdapter = buildReportJobResponseAdapter(fileStream);
  const requestLike = createPdfJobRequest(req);
  const fileFinished = new Promise((resolve, reject) => {
    fileStream.once('finish', resolve);
    fileStream.once('error', reject);
  }).catch(() => null);

  updateReportJob(jobId, {
    status: 'processing',
    message: 'Generando PDF de horas extra...'
  });

  try {
    await handleDescargar(requestLike, responseAdapter);

    if (responseAdapter.__statusCode >= 400 || responseAdapter.__jsonPayload) {
      const payload = responseAdapter.__jsonPayload || {};
      const message = payload.error || payload.message || 'No se pudo generar el PDF.';
      finalizeReportJob(jobId, 'error', message, {
        error: payload.error || message,
        filePath
      });
      try { fileStream.destroy(); } catch (_) { /* no-op */ }
      try { fs.unlinkSync(filePath); } catch (_) { /* no-op */ }
      return;
    }

    await fileFinished;

    finalizeReportJob(jobId, 'ready', 'PDF listo para descargar.', {
      filePath,
      fileName: 'horas_jornada_compilado.pdf'
    });
  } catch (err) {
    finalizeReportJob(jobId, 'error', err?.message || 'Error generando el PDF.', {
      error: err?.message || 'Error generando el PDF.',
      filePath
    });
    try { fileStream.destroy(); } catch (_) { /* no-op */ }
    try { fs.unlinkSync(filePath); } catch (_) { /* no-op */ }
  }
}

function buildProfileReportRow(row, profileKey = 'bomberman') {
  const normalizedProfile = normalizeAdminHorasExtraProfile(profileKey);
  if (normalizedProfile !== 'gruas') return row;
  const fecha = formatDateOnly(row.fecha_servicio);
  const calculos = (row.hora_ingreso && row.hora_salida)
    ? calculateReportMetrics('gruas', {
      hora_ingreso: row.hora_ingreso,
      hora_salida: row.hora_salida,
      minutos_almuerzo: Number(row.minutos_almuerzo || 0),
      fecha
    })
    : { horas_trabajadas: 0, hed: 0, hen: 0, rn: 0, fest: 0, rfn: 0, hedf: 0, henf: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, festivo: false, dia_semana: null };

  return {
    ...row,
    ...calculos,
    payment_breakdown: row.payment_breakdown || createEmptyPaymentBreakdown(),
    desglose_pago: row.desglose_pago || buildPaymentBreakdownLabel(row.payment_breakdown || createEmptyPaymentBreakdown())
  };
}

function agruparJornadasPorDiaPorPerfil(rows, profileKey = 'bomberman') {
  const normalizedProfile = normalizeAdminHorasExtraProfile(profileKey);
  const grupos = new Map();

  for (const r of rows || []) {
    const fecha = formatDateOnly(r.fecha_servicio);
    const mesAnio = fecha ? fecha.slice(0, 7) : 'Sin fecha';
    const operador = r.nombre_operador || 'Sin nombre';
    const key = `${operador}|${fecha}`;

    if (!grupos.has(key)) {
      grupos.set(key, {
        nombre_operador: operador,
        cargo: String(r.cargo || ''),
        empresaId: r.empresa_id ?? null,
        empresaNombre: String(r.empresa || '').trim(),
        fecha,
        mesAnio,
        rawMinutes: 0,
        lunchMinutes: 0,
        hasValidRow: false,
        invalidRows: 0,
        horas_brutas: 0,
        descuento_almuerzo: 0,
        horas_trabajadas: 0,
        extra_diurna: 0,
        extra_nocturna: 0,
        extra_festiva: 0,
        total_extras: 0,
        hed: 0,
        hen: 0,
        rn: 0,
        fest: 0,
        rfn: 0,
        hedf: 0,
        henf: 0,
        jornada_normal_0600_1600: 0,
        total_extras_pago: 0,
        payment_breakdown: createEmptyPaymentBreakdown()
      });
    }

    const grupo = grupos.get(key);
    if (!grupo.cargo && r.cargo) grupo.cargo = String(r.cargo);
    if (!grupo.empresaId && r.empresa_id != null) grupo.empresaId = r.empresa_id;
    if (!grupo.empresaNombre && r.empresa) grupo.empresaNombre = String(r.empresa).trim();
    if (!r.hora_ingreso) {
      grupo.invalidRows += 1;
      continue;
    }

    const window = buildReportTimeWindow({ fecha, hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida });
    if (!window) {
      grupo.invalidRows += 1;
      continue;
    }

    const rawMinutes = calcularMinutosRegistro({
      hora_ingreso: r.hora_ingreso,
      hora_salida: r.hora_salida,
      hora_salida_calculada: window.syntheticExit ? window.dtSalida.toFormat('HH:mm:ss') : null,
      fecha
    });
    const metricas = calculateReportMetrics(profileKey, {
      hora_ingreso: r.hora_ingreso,
      hora_salida: window.dtSalida.toFormat('HH:mm:ss'),
      fecha,
      aplicar_descuento_almuerzo: false
    }) || { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, hed: 0, hen: 0, rn: 0, fest: 0, rfn: 0, hedf: 0, henf: 0 };

    grupo.rawMinutes += rawMinutes;
    grupo.hasValidRow = true;
    grupo.extra_diurna += Number(metricas.extra_diurna || 0);
    grupo.extra_nocturna += Number(metricas.extra_nocturna || 0);
    grupo.extra_festiva += Number(metricas.extra_festiva || 0);
    grupo.total_extras += Number(metricas.total_extras || 0);
    grupo.hed += Number(metricas.hed || 0);
    grupo.hen += Number(metricas.hen || 0);
    grupo.rn += Number(metricas.rn || 0);
    grupo.fest += Number(metricas.fest || 0);
    grupo.rfn += Number(metricas.rfn || 0);
    grupo.hedf += Number(metricas.hedf || 0);
    grupo.henf += Number(metricas.henf || 0);

    const paymentBreakdown = buildRowPaymentBreakdown({
      ...r,
      fecha_servicio: r.fecha_servicio,
      hora_salida: window.dtSalida.toFormat('HH:mm:ss'),
      minutos_almuerzo: 0
    }, normalizedProfile);
    addPaymentBreakdown(grupo.payment_breakdown, paymentBreakdown);
  }

  return Array.from(grupos.values()).map((grupo) => {
    const lunchMinutes = getReportLunchDeductionMinutes(grupo.rawMinutes);
    const horasBrutas = Math.max(0, grupo.rawMinutes) / 60;
    const descuentoAlmuerzo = Math.max(0, lunchMinutes) / 60;
    const horasTrabajadas = Math.max(0, horasBrutas - descuentoAlmuerzo);
    if (normalizedProfile === 'gruas') {
      const payment = grupo.payment_breakdown || createEmptyPaymentBreakdown();
      return {
        ...grupo,
        horas_brutas: +horasBrutas.toFixed(2),
        descuento_almuerzo: +descuentoAlmuerzo.toFixed(2),
        horas_trabajadas: +horasTrabajadas.toFixed(2),
        jornada_normal_0600_1600: +Number(payment.jornada_normal_0600_1600 || 0).toFixed(2),
        hed: +(Number(payment.hed || 0)).toFixed(2),
        hen: +(Number(payment.hen || 0)).toFixed(2),
        rn: +(Number(payment.rn || 0)).toFixed(2),
        fest: +(Number(payment.fest || 0)).toFixed(2),
        rfn: +(Number(payment.rfn || 0)).toFixed(2),
        hedf: +(Number(payment.hedf || 0)).toFixed(2),
        henf: +(Number(payment.henf || 0)).toFixed(2),
        total_extras_pago: +(Number(payment.total_extras_pago || 0)).toFixed(2)
      };
    }

    return {
      ...grupo,
      horas_brutas: +horasBrutas.toFixed(2),
      descuento_almuerzo: +descuentoAlmuerzo.toFixed(2),
      horas_trabajadas: +horasTrabajadas.toFixed(2),
      total_extra_diurna: +Number(grupo.extra_diurna || 0).toFixed(2),
      total_extra_nocturna: +Number(grupo.extra_nocturna || 0).toFixed(2),
      total_extra_festiva: +Number(grupo.extra_festiva || 0).toFixed(2),
      total_horas_extras: +Number(grupo.total_extras || 0).toFixed(2)
    };
  });
}

/**
 * Enriches report rows with readable company and audit defaults.
 * @param {Array<object>} rows
 * @param {Record<string, string>} empresaMap
 * @returns {Array<object>}
 */
function enrichReportRows(rows, empresaMap) {
  return (rows || []).map((row) => {
    const empresaKey = row?.empresa_id != null ? String(row.empresa_id) : '';
    const empresaNombre = empresaMap?.[empresaKey] || String(row?.empresa || row?.empresa_nombre || row?.rol || empresaKey || '').trim();
    const isAuditAttempt = row?.row_kind === 'audit_attempt';
    const isValidRow = !isAuditAttempt && Boolean(row?.hora_ingreso && row?.hora_salida);

    return {
      ...row,
      rol: empresaNombre || empresaKey || '',
      empresa_nombre: empresaNombre || '',
      audit_message: row?.audit_message || (isValidRow ? 'Marcación válida' : isAuditAttempt ? 'Intento de salida fallido' : 'Sin validación'),
      audit_distance_meters: row?.audit_distance_meters == null ? (isValidRow ? 0 : 0) : row.audit_distance_meters,
      audit_within_range: row?.audit_within_range == null ? (isValidRow ? true : (isAuditAttempt ? false : null)) : row.audit_within_range
    };
  });
}

async function buildCombinedReportRows(pool, jornadas, sedeMap, cierreLocationMap, reportProfile = 'gruas') {
  const ids = Array.from(new Set((jornadas || []).filter((r) => r?.id != null).map((r) => Number(r.id)).filter(Number.isFinite)));
  if (ids.length === 0) return [];

  const auditQuery = await pool.query(
    `SELECT
       id,
       horas_jornada_id,
       event_type,
       action,
       message,
       obra_nombre,
       latitude,
       longitude,
       accuracy_meters,
       distance_meters,
       within_range,
       created_at
     FROM attendance_location_audit_logs
     WHERE horas_jornada_id = ANY($1::int[])
       AND event_type = 'salida_attempt'
       AND action <> 'allowed'
     ORDER BY horas_jornada_id, created_at ASC, id ASC`,
    [ids]
  );

  const auditsByJornada = new Map();
  for (const audit of auditQuery.rows) {
    const key = Number(audit.horas_jornada_id);
    if (!auditsByJornada.has(key)) auditsByJornada.set(key, []);
    auditsByJornada.get(key).push(audit);
  }

  const combinedRows = [];

  for (const jornada of jornadas) {
    const fecha = formatDateOnly(jornada.fecha_servicio);
    const sede = sedeMap[jornada.nombre_proyecto] || '';
    const cierre = cierreLocationMap[jornada.id] || null;
    const baseTime = jornada.hora_salida || jornada.hora_ingreso || '';
    const hasIngreso = Boolean(jornada.hora_ingreso);
    const timeWindow = hasIngreso ? buildReportTimeWindow({ fecha, hora_ingreso: jornada.hora_ingreso, hora_salida: jornada.hora_salida }) : null;
    const effectiveHoraSalida = timeWindow ? timeWindow.dtSalida.toFormat('HH:mm:ss') : (jornada.hora_salida || '');
    const hasReportableRow = Boolean(hasIngreso && timeWindow);
    const calculos = hasReportableRow
      ? calcularHoras({
          hora_ingreso: jornada.hora_ingreso,
          hora_salida: effectiveHoraSalida,
          fecha,
          aplicar_descuento_almuerzo: false
        })
      : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras: 0, festivo: false, dia_semana: null };
    const paymentBreakdown = hasReportableRow
      ? calculatePaymentBreakdown({
        hora_ingreso: jornada.hora_ingreso,
        hora_salida: effectiveHoraSalida,
        minutos_almuerzo: 0,
        fecha,
        fecha_servicio: jornada.fecha_servicio,
        aplicar_descuento_almuerzo: false
      }, reportProfile)
      : createEmptyPaymentBreakdown();
    combinedRows.push({
      ...jornada,
      fecha_servicio: fecha,
      sede,
      report_profile: reportProfile,
      tipo_evento: jornada.hora_salida ? 'Salida válida' : (hasIngreso ? 'Salida calculada' : 'Jornada sin cierre'),
      hora_evento: effectiveHoraSalida ? String(effectiveHoraSalida).slice(0, 8) : (baseTime ? String(baseTime).slice(0, 8) : ''),
      hora_salida: effectiveHoraSalida || jornada.hora_salida || '',
      minutos_almuerzo: hasReportableRow ? Number(jornada.minutos_almuerzo || 0) : 0,
      horas_trabajadas: +(calculos.horas_trabajadas || 0).toFixed(2),
      jornada_normal_0600_1600: +(paymentBreakdown.jornada_normal_0600_1600 || 0).toFixed(2),
      hed: +(paymentBreakdown.hed || 0).toFixed(2),
      hen: +(paymentBreakdown.hen || 0).toFixed(2),
      rn: +(paymentBreakdown.rn || 0).toFixed(2),
      fest: +(paymentBreakdown.fest || 0).toFixed(2),
      rfn: +(paymentBreakdown.rfn || 0).toFixed(2),
      hedf: +(paymentBreakdown.hedf || 0).toFixed(2),
      henf: +(paymentBreakdown.henf || 0).toFixed(2),
      total_extras_pago: +(paymentBreakdown.total_extras_pago || 0).toFixed(2),
      extra_diurna: +(calculos.extra_diurna || 0).toFixed(2),
      extra_nocturna: +(calculos.extra_nocturna || 0).toFixed(2),
      extra_festiva: +(calculos.extra_festiva || 0).toFixed(2),
      total_extras: +(calculos.total_extras || 0).toFixed(2),
      festivo: !!calculos.festivo,
      dia_semana: calculos.dia_semana || '',
      total_horas: +(calculos.horas_trabajadas || 0).toFixed(2),
      ubicacion_cierre_url: cierre?.mapsUrl || null,
      audit_message: jornada.hora_salida
        ? 'Marcación válida'
        : (hasIngreso ? `No registró salida; se calculó con jornada de ${getReportDailyWorkHours().toFixed(2)} horas` : 'Sin ingreso'),
      audit_distance_meters: cierre?.distanceMeters ?? 0,
      audit_within_range: cierre?.withinRange ?? null,
      payment_breakdown: paymentBreakdown,
      desglose_pago: buildPaymentBreakdownLabel(paymentBreakdown),
      sort_key: `${fecha}T${String(effectiveHoraSalida || baseTime || '00:00:00').slice(0, 8)}-0`
    });

    const audits = auditsByJornada.get(Number(jornada.id)) || [];
    for (const audit of audits) {
      const createdAt = audit.created_at instanceof Date
        ? audit.created_at
        : new Date(audit.created_at);
      const auditDt = DateTime.fromJSDate(createdAt, { zone: 'utc' }).setZone('America/Bogota');
      const auditTime = auditDt.isValid ? auditDt.toFormat('HH:mm:ss') : '';
      const mapsUrl = buildGoogleMapsUrl(audit.latitude, audit.longitude);
      const obraNombre = String(audit.obra_nombre || jornada.nombre_proyecto || '').trim();
      combinedRows.push({
        ...jornada,
        fecha_servicio: fecha,
        sede,
        row_kind: 'audit_attempt',
        tipo_evento: 'Intento de salida fallido',
        hora_evento: auditTime,
        hora_salida: auditTime,
        minutos_almuerzo: 0,
        horas_trabajadas: 0,
        jornada_normal_0600_1600: 0,
        hed: 0,
        hen: 0,
        rn: 0,
        fest: 0,
        rfn: 0,
        hedf: 0,
        henf: 0,
        total_extras_pago: 0,
        extra_diurna: 0,
        extra_nocturna: 0,
        extra_festiva: 0,
        total_extras: 0,
        festivo: false,
        dia_semana: '',
        report_profile: reportProfile,
        audit_message: audit.message || '',
        audit_distance_meters: audit.distance_meters ?? null,
        audit_within_range: audit.within_range ?? null,
        ubicacion_cierre_url: mapsUrl,
        payment_breakdown: createEmptyPaymentBreakdown(),
        desglose_pago: '0.00',
        sort_key: `${fecha}T${auditTime || '00:00:00'}-1-${audit.id}`
      });
    }
  }

  return sortReportRows(combinedRows);
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
    const reportProfile = resolveAdminHorasExtraProfile(req);
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
    const empresaMap = await buildEmpresaMap(pool);
    const cierreLocationMap = await buildCierreLocationMap(pool, q.rows.map(r => r.id));

    const idsVistos = new Set();
    const clavesVistas = new Set();
    const rows = q.rows.reduce((acc, r) => {
      if (r.id != null && idsVistos.has(r.id)) return acc;
      if (r.id != null) idsVistos.add(r.id);
      const clave = `${r.nombre_operador}|${r.fecha_servicio}|${r.hora_ingreso}|${r.hora_salida}`;
      if (clavesVistas.has(clave)) return acc;
      clavesVistas.add(clave);
      const fecha = formatDateOnly(r.fecha_servicio);
      const window = buildReportTimeWindow({ fecha, hora_ingreso: r.hora_ingreso, hora_salida: r.hora_salida });
      const effectiveHoraSalida = window ? window.dtSalida.toFormat('HH:mm:ss') : (r.hora_salida || '');
      const calculos = (r.hora_ingreso && window)
        ? calcularHoras({ hora_ingreso: r.hora_ingreso, hora_salida: effectiveHoraSalida, fecha, aplicar_descuento_almuerzo: false })
        : { horas_trabajadas: 0, extra_diurna: 0, extra_nocturna: 0, extra_festiva: 0, total_extras:0, festivo:false, dia_semana: null };
      const paymentBreakdown = buildRowPaymentBreakdown({
        ...r,
        fecha_servicio: fecha,
        fecha,
        hora_salida: effectiveHoraSalida,
        aplicar_descuento_almuerzo: false,
        horas_trabajadas: calculos.horas_trabajadas || 0,
        extra_diurna: calculos.extra_diurna || 0,
        extra_nocturna: calculos.extra_nocturna || 0,
        extra_festiva: calculos.extra_festiva || 0,
        total_extras: calculos.total_extras || 0
      }, reportProfile);
      const total_horas = +( (calculos.horas_trabajadas || 0) ).toFixed(2);
      const sede = sedeMap[r.nombre_proyecto] || '';
      const cierre = cierreLocationMap[r.id] || null;
      const ubicacion_cierre = cierre?.display || sede;
      acc.push({
        ...r,
        fecha_servicio: fecha,
        hora_salida: effectiveHoraSalida,
        sede,
        rol: empresaMap[String(r.empresa_id)] || r.empresa || String(r.empresa_id || ''),
        empresa_nombre: empresaMap[String(r.empresa_id)] || r.empresa || '',
        ubicacion_cierre,
        ubicacion_cierre_url: cierre?.mapsUrl || null,
        ubicacion_cierre_action: cierre?.action || null,
        sede_cierre: ubicacion_cierre,
        tipo_evento: r.hora_salida ? 'Salida válida' : 'Salida calculada',
        audit_message: r.hora_salida ? 'Marcación válida' : `No registró salida; se calculó con jornada de ${getReportDailyWorkHours().toFixed(2)} horas`,
        audit_distance_meters: cierre?.distanceMeters ?? 0,
        audit_within_range: cierre?.withinRange ?? null,
        ...calculos,
        report_profile: reportProfile,
        payment_breakdown: paymentBreakdown,
        desglose_pago: paymentBreakdown.desglose_pago,
        total_horas
      });
      return acc;
    }, []);

    return res.json({ success:true, count: total, limit: parseInt(limit,10)||0, offset: parseInt(offset,10)||0, perfil_reporte: reportProfile, rows });
  } catch (err) {
    console.error("Error en /administrador/admin_horas_extra/buscar:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * POST /administrador/admin_horas_extra/resumen
 * Retorna un resumen de horas extras mes a mes agrupado por operador.
 * Se requiere al menos un parámetro de filtro. Obtiene todos los registros coincidentes
 * para exactitud del resumen; aplica paginaciÃ³n solo a la lista plana de registros.
 * @body {{ nombre?: string, obra?: string, constructora?: string, empresa_id?: number, empresa_ids?: number[], fecha_inicio?: string, fecha_fin?: string, limit?: number, offset?: number }}
 * @returns {{ success: boolean, count: number, periodo: object, resumen_por_mes: Array, registros: Array }}
 * @throws {400} Si no se proporciona ningún parámetro de filtro.
 */
async function handleResumen(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const reportProfile = resolveAdminHorasExtraProfile(req);
    const profileCode = reportProfile === 'gruas' ? 'gruaman' : 'bomberman';
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

    let registros = [];
    const resumenPorMes = {};
    const sedeMap = await buildSedeMap(pool);
    const empresaMap = await buildEmpresaMap(pool);
    const cierreLocationMap = await buildCierreLocationMap(pool, qAll.rows.map(r => r.id));
    const gruposDia = agruparJornadasPorDiaPorPerfil(qAll.rows, profileCode);

    for (const grupo of gruposDia) {
      if (!grupo.hasValidRow) continue;
      const mesAnio = grupo.mesAnio || 'Sin fecha';
      if (!resumenPorMes[mesAnio]) {
        resumenPorMes[mesAnio] = {
          mes: mesAnio,
          usuarios: {},
          totales: {
            horas_brutas: 0,
            descuento_almuerzo: 0,
            horas_trabajadas: 0,
            extra_diurna: 0,
            extra_nocturna: 0,
            extra_festiva: 0,
            total_extras: 0,
            jornada_normal_0600_1600: 0,
            hed: 0,
            hen: 0,
            rn: 0,
            fest: 0,
            rfn: 0,
            hedf: 0,
            henf: 0,
            total_extras_pago: 0
          }
        };
      }

      const operador = grupo.nombre_operador || 'Sin nombre';
      if (!resumenPorMes[mesAnio].usuarios[operador]) {
        resumenPorMes[mesAnio].usuarios[operador] = {
          nombre_operador: operador,
          rol: resolveRolName(grupo, empresaMap),
          cargo: grupo.cargo || '',
          _diasSet: new Set(),
          total_dias_trabajados: 0,
          total_horas_brutas: 0,
          total_descuento_almuerzo: 0,
          total_horas_trabajadas: 0,
          total_extra_diurna: 0,
          total_extra_nocturna: 0,
          total_extra_festiva: 0,
          total_horas_extras: 0,
          registros_incompletos: 0,
          jornada_normal_0600_1600: 0,
          hed: 0,
          hen: 0,
          rn: 0,
          fest: 0,
          rfn: 0,
          hedf: 0,
          henf: 0,
          total_extras_pago: 0
        };
      }

      const horasBrutas = Number(grupo.horas_brutas ?? Math.max(0, grupo.rawMinutes) / 60);
      const descuentoAlmuerzo = Number(grupo.descuento_almuerzo ?? Math.max(0, grupo.lunchMinutes) / 60);
      const horasDia = Number(grupo.horas_trabajadas ?? Math.max(0, horasBrutas - descuentoAlmuerzo));
      const jornadaNormal = reportProfile === 'gruas'
        ? Number(grupo.jornada_normal_0600_1600 || 0)
        : Math.max(
            0,
            horasDia - Number(grupo.total_extras || 0) - Number(grupo.rn || 0) - Number(grupo.rfn || 0) - Number(grupo.fest || 0)
          );
      resumenPorMes[mesAnio].usuarios[operador].rol = resumenPorMes[mesAnio].usuarios[operador].rol || resolveRolName(grupo, empresaMap);
      resumenPorMes[mesAnio].usuarios[operador].cargo = resumenPorMes[mesAnio].usuarios[operador].cargo || '';
      resumenPorMes[mesAnio].usuarios[operador].total_dias_trabajados += 1;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_brutas += horasBrutas;
      resumenPorMes[mesAnio].usuarios[operador].total_descuento_almuerzo += descuentoAlmuerzo;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_trabajadas += horasDia;
      if (reportProfile === 'gruas') {
        resumenPorMes[mesAnio].usuarios[operador].jornada_normal_0600_1600 += jornadaNormal;
        resumenPorMes[mesAnio].usuarios[operador].hed += grupo.hed || 0;
        resumenPorMes[mesAnio].usuarios[operador].hen += grupo.hen || 0;
        resumenPorMes[mesAnio].usuarios[operador].rn += grupo.rn || 0;
        resumenPorMes[mesAnio].usuarios[operador].fest += grupo.fest || 0;
        resumenPorMes[mesAnio].usuarios[operador].rfn += grupo.rfn || 0;
        resumenPorMes[mesAnio].usuarios[operador].hedf += grupo.hedf || 0;
        resumenPorMes[mesAnio].usuarios[operador].henf += grupo.henf || 0;
        resumenPorMes[mesAnio].usuarios[operador].total_horas_extras += Number(grupo.total_extras_pago || 0);
      } else {
        resumenPorMes[mesAnio].usuarios[operador].total_extra_diurna += grupo.extra_diurna || 0;
        resumenPorMes[mesAnio].usuarios[operador].total_extra_nocturna += grupo.extra_nocturna || 0;
        resumenPorMes[mesAnio].usuarios[operador].total_extra_festiva += grupo.extra_festiva || 0;
        resumenPorMes[mesAnio].usuarios[operador].total_horas_extras += grupo.total_extras || 0;
      }
      resumenPorMes[mesAnio].usuarios[operador].registros_incompletos += grupo.invalidRows || 0;

      resumenPorMes[mesAnio].totales.horas_brutas += horasBrutas;
      resumenPorMes[mesAnio].totales.descuento_almuerzo += descuentoAlmuerzo;
      resumenPorMes[mesAnio].totales.horas_trabajadas += horasDia;
      if (reportProfile === 'gruas') {
        resumenPorMes[mesAnio].totales.jornada_normal_0600_1600 += jornadaNormal;
        resumenPorMes[mesAnio].totales.hed += grupo.hed || 0;
        resumenPorMes[mesAnio].totales.hen += grupo.hen || 0;
        resumenPorMes[mesAnio].totales.rn += grupo.rn || 0;
        resumenPorMes[mesAnio].totales.fest += grupo.fest || 0;
        resumenPorMes[mesAnio].totales.rfn += grupo.rfn || 0;
        resumenPorMes[mesAnio].totales.hedf += grupo.hedf || 0;
        resumenPorMes[mesAnio].totales.henf += grupo.henf || 0;
        resumenPorMes[mesAnio].totales.total_extras_pago += Number(grupo.total_extras_pago || 0);
      } else {
        resumenPorMes[mesAnio].totales.extra_diurna += grupo.extra_diurna || 0;
        resumenPorMes[mesAnio].totales.extra_nocturna += grupo.extra_nocturna || 0;
        resumenPorMes[mesAnio].totales.extra_festiva += grupo.extra_festiva || 0;
        resumenPorMes[mesAnio].totales.total_extras += grupo.total_extras || 0;
      }
    }

    registros = await buildCombinedReportRows(pool, q.rows, sedeMap, cierreLocationMap, reportProfile);
    registros = enrichReportRows(registros, empresaMap).map((row) => buildProfileReportRow(row, reportProfile));

    const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const resumenMeses = Object.keys(resumenPorMes)
      .sort()
      .map(mesAnio => {
        const [anio, mes] = mesAnio.split('-');
        const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;

        const usuarios = Object.values(resumenPorMes[mesAnio].usuarios)
          .map(({ _diasSet, ...u }) => {
            if (reportProfile === 'gruas') {
              return {
                ...u,
                total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
                jornada_normal_0600_1600: +u.jornada_normal_0600_1600.toFixed(2),
                hed: +u.hed.toFixed(2),
                hen: +u.hen.toFixed(2),
                rn: +u.rn.toFixed(2),
                fest: +u.fest.toFixed(2),
                rfn: +u.rfn.toFixed(2),
                hedf: +u.hedf.toFixed(2),
                henf: +u.henf.toFixed(2),
                total_horas_extras: +u.total_horas_extras.toFixed(2),
                total_extras_pago: +u.total_extras_pago.toFixed(2),
                desglose_pago: buildPaymentBreakdownLabel({
                  jornada_normal_0600_1600: u.jornada_normal_0600_1600,
                  hed: u.hed,
                  hen: u.hen,
                  rn: u.rn,
                  fest: u.fest,
                  rfn: u.rfn,
                  hedf: u.hedf,
                  henf: u.henf
                })
              };
            }
            return {
              ...u,
              total_horas_brutas: +u.total_horas_brutas.toFixed(2),
              total_descuento_almuerzo: +u.total_descuento_almuerzo.toFixed(2),
              total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
              total_extra_diurna: +u.total_extra_diurna.toFixed(2),
              total_extra_nocturna: +u.total_extra_nocturna.toFixed(2),
              total_extra_festiva: +u.total_extra_festiva.toFixed(2),
              total_horas_extras: +u.total_horas_extras.toFixed(2)
            };
          })
          .sort((a, b) => a.nombre_operador.localeCompare(b.nombre_operador));

        return {
          mes: mesAnio,
          mes_nombre: `${nombreMes} ${anio}`,
          resumen_usuarios: usuarios,
          totales: reportProfile === 'gruas'
            ? {
              total_horas_trabajadas: +resumenPorMes[mesAnio].totales.horas_trabajadas.toFixed(2),
              jornada_normal_0600_1600: +resumenPorMes[mesAnio].totales.jornada_normal_0600_1600.toFixed(2),
              hed: +resumenPorMes[mesAnio].totales.hed.toFixed(2),
              hen: +resumenPorMes[mesAnio].totales.hen.toFixed(2),
              rn: +resumenPorMes[mesAnio].totales.rn.toFixed(2),
              fest: +resumenPorMes[mesAnio].totales.fest.toFixed(2),
              rfn: +resumenPorMes[mesAnio].totales.rfn.toFixed(2),
              hedf: +resumenPorMes[mesAnio].totales.hedf.toFixed(2),
              henf: +resumenPorMes[mesAnio].totales.henf.toFixed(2),
              total_horas_extras: +resumenPorMes[mesAnio].totales.total_extras_pago.toFixed(2),
              total_extras_pago: +resumenPorMes[mesAnio].totales.total_extras_pago.toFixed(2),
              desglose_pago: buildPaymentBreakdownLabel({
                jornada_normal_0600_1600: resumenPorMes[mesAnio].totales.jornada_normal_0600_1600,
                hed: resumenPorMes[mesAnio].totales.hed,
                hen: resumenPorMes[mesAnio].totales.hen,
                  rn: resumenPorMes[mesAnio].totales.rn,
                  fest: resumenPorMes[mesAnio].totales.fest,
                  rfn: resumenPorMes[mesAnio].totales.rfn,
                  hedf: resumenPorMes[mesAnio].totales.hedf,
                  henf: resumenPorMes[mesAnio].totales.henf
                })
              }
            : {
                total_horas_trabajadas: +resumenPorMes[mesAnio].totales.horas_trabajadas.toFixed(2),
                total_horas_brutas: +resumenPorMes[mesAnio].totales.horas_brutas.toFixed(2),
                total_descuento_almuerzo: +resumenPorMes[mesAnio].totales.descuento_almuerzo.toFixed(2),
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
      perfil_reporte: reportProfile,
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
 * - `pdf`: Un único PDF compilado con portada de resumen, tablas de resumen, portada de detalle y tablas detalladas.
 * - Por defecto: CSV con todos los campos calculados.
 * @body {{ nombre?: string, obra?: string, constructora?: string, empresa_id?: number, empresa_ids?: number[], fecha_inicio?: string, fecha_fin?: string, formato?: 'excel'|'pdf'|'csv', limit?: number }}
 * @returns {Buffer} Adjunto en el formato solicitado.
 */
async function handleDescargar(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const reportProfile = resolveAdminHorasExtraProfile(req);
    const profileConfig = getReportProfileConfig(reportProfile);
    const { nombre, obra, constructora, empresa_id, empresa_ids, fecha_inicio, fecha_fin, formato = 'excel', limit = 50000 } = req.body || {};
    const downloadMode = String(req.body?.modo || req.body?.mode || req.body?.async || '').trim().toLowerCase();
    if (formato === 'pdf' && ['job', 'async', 'background', 'as_job', 'true', '1'].includes(downloadMode)) {
      return handleStartHorasExtraPdfJob(req, res);
    }
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
    const downloadLimit = formato === 'pdf'
      ? 50000
      : Math.min(50000, parseInt(limit,10)||50000);
    const q = await pool.query(
      `SELECT * FROM horas_jornada ${where} ORDER BY fecha_servicio DESC LIMIT $${values.length+1}`,
      [...values, downloadLimit]
    );

    const sedeMap = await buildSedeMap(pool);
    const empresaMap = await buildEmpresaMap(pool);
    const cierreLocationMap = await buildCierreLocationMap(pool, q.rows.map(r => r.id));
    const rows = enrichReportRows(
      await buildCombinedReportRows(pool, q.rows, sedeMap, cierreLocationMap, reportProfile),
      empresaMap
    ).map((row) => buildProfileReportRow(row, reportProfile));
    const gruposDia = agruparJornadasPorDiaPorPerfil(q.rows, reportProfile);
    const resumenPorMes = {};
    const nombresMeses = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    for (const grupo of gruposDia) {
      if (!grupo.hasValidRow) continue;
      const mesAnio = grupo.mesAnio || 'Sin fecha';

      if (!resumenPorMes[mesAnio]) {
        resumenPorMes[mesAnio] = {
          mes: mesAnio,
          usuarios: {},
          totales: {
            horas_brutas: 0,
            descuento_almuerzo: 0,
            horas_trabajadas: 0,
            extra_diurna: 0,
            extra_nocturna: 0,
            extra_festiva: 0,
            total_extras: 0,
            jornada_normal_0600_1600: 0,
            hed: 0,
            hen: 0,
            rn: 0,
            fest: 0,
            rfn: 0,
            hedf: 0,
            henf: 0,
            total_extras_pago: 0
          }
        };
      }

      const operador = grupo.nombre_operador || 'Sin nombre';
      if (!resumenPorMes[mesAnio].usuarios[operador]) {
        resumenPorMes[mesAnio].usuarios[operador] = {
          nombre_operador: operador,
          rol: resolveRolName(grupo, empresaMap),
          cargo: grupo.cargo || '',
          _diasSet: new Set(),
          total_dias_trabajados: 0,
          total_horas_brutas: 0,
          total_descuento_almuerzo: 0,
          total_horas_trabajadas: 0,
          total_extra_diurna: 0,
          total_extra_nocturna: 0,
          total_extra_festiva: 0,
          total_horas_extras: 0,
          jornada_normal_0600_1600: 0,
          hed: 0,
          hen: 0,
          rn: 0,
          fest: 0,
          rfn: 0,
          hedf: 0,
          henf: 0,
          total_extras_pago: 0
        };
      }

      const horasBrutas = Number(grupo.horas_brutas ?? Math.max(0, grupo.rawMinutes) / 60);
      const descuentoAlmuerzo = Number(grupo.descuento_almuerzo ?? Math.max(0, grupo.lunchMinutes) / 60);
      const horasDia = Number(grupo.horas_trabajadas ?? Math.max(0, horasBrutas - descuentoAlmuerzo));
      const jornadaNormal = Math.max(
        0,
        horasDia - Number(grupo.total_extras || 0) - Number(grupo.rn || 0) - Number(grupo.rfn || 0) - Number(grupo.fest || 0)
      );
      resumenPorMes[mesAnio].usuarios[operador].rol = resumenPorMes[mesAnio].usuarios[operador].rol || resolveRolName(grupo, empresaMap);
      resumenPorMes[mesAnio].usuarios[operador].total_dias_trabajados += 1;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_brutas += horasBrutas;
      resumenPorMes[mesAnio].usuarios[operador].total_descuento_almuerzo += descuentoAlmuerzo;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_trabajadas += horasDia;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_diurna += grupo.extra_diurna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_nocturna += grupo.extra_nocturna || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extra_festiva += grupo.extra_festiva || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_horas_extras += grupo.total_extras || 0;
      resumenPorMes[mesAnio].usuarios[operador].jornada_normal_0600_1600 += jornadaNormal;
      resumenPorMes[mesAnio].usuarios[operador].hed += grupo.hed || 0;
      resumenPorMes[mesAnio].usuarios[operador].hen += grupo.hen || 0;
      resumenPorMes[mesAnio].usuarios[operador].rn += grupo.rn || 0;
      resumenPorMes[mesAnio].usuarios[operador].fest += grupo.fest || 0;
      resumenPorMes[mesAnio].usuarios[operador].rfn += grupo.rfn || 0;
      resumenPorMes[mesAnio].usuarios[operador].hedf += grupo.hedf || 0;
      resumenPorMes[mesAnio].usuarios[operador].henf += grupo.henf || 0;
      resumenPorMes[mesAnio].usuarios[operador].total_extras_pago += grupo.total_extras || 0;

      resumenPorMes[mesAnio].totales.horas_brutas += horasBrutas;
      resumenPorMes[mesAnio].totales.descuento_almuerzo += descuentoAlmuerzo;
      resumenPorMes[mesAnio].totales.horas_trabajadas += horasDia;
      resumenPorMes[mesAnio].totales.extra_diurna += grupo.extra_diurna || 0;
      resumenPorMes[mesAnio].totales.extra_nocturna += grupo.extra_nocturna || 0;
      resumenPorMes[mesAnio].totales.extra_festiva += grupo.extra_festiva || 0;
      resumenPorMes[mesAnio].totales.total_extras += grupo.total_extras || 0;
      resumenPorMes[mesAnio].totales.jornada_normal_0600_1600 += jornadaNormal;
      resumenPorMes[mesAnio].totales.hed += grupo.hed || 0;
      resumenPorMes[mesAnio].totales.hen += grupo.hen || 0;
      resumenPorMes[mesAnio].totales.rn += grupo.rn || 0;
      resumenPorMes[mesAnio].totales.fest += grupo.fest || 0;
      resumenPorMes[mesAnio].totales.rfn += grupo.rfn || 0;
      resumenPorMes[mesAnio].totales.hedf += grupo.hedf || 0;
      resumenPorMes[mesAnio].totales.henf += grupo.henf || 0;
      resumenPorMes[mesAnio].totales.total_extras_pago += grupo.total_extras || 0;
    }

    const mesesOrdenados = Object.keys(resumenPorMes).sort();

    if (formato === 'excel') {
      const workbook = new ExcelJS.Workbook();

      for (const mesAnio of mesesOrdenados) {
        const [anio, mes] = mesAnio.split('-');
        const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;
        const nombreHoja = `${nombreMes} ${anio}`;

        const resumenUsuarios = Object.values(resumenPorMes[mesAnio].usuarios)
          .map(({ _diasSet, ...u }) => {
            if (reportProfile === 'gruas') {
              return {
                ...u,
                total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
                jornada_normal_0600_1600: +u.jornada_normal_0600_1600.toFixed(2),
                hed: +u.hed.toFixed(2),
                hen: +u.hen.toFixed(2),
                rn: +u.rn.toFixed(2),
                fest: +u.fest.toFixed(2),
                rfn: +u.rfn.toFixed(2),
                hedf: +u.hedf.toFixed(2),
                henf: +u.henf.toFixed(2),
                total_horas_extras: +u.total_horas_extras.toFixed(2),
                desglose_pago: u.desglose_pago || buildPaymentBreakdownLabel({
                  jornada_normal_0600_1600: u.jornada_normal_0600_1600,
                  hed: u.hed,
                  hen: u.hen,
                  rn: u.rn,
                  fest: u.fest,
                  rfn: u.rfn,
                  hedf: u.hedf,
                  henf: u.henf
                })
              };
            }
            return {
              ...u,
              total_horas_brutas: +u.total_horas_brutas.toFixed(2),
              total_descuento_almuerzo: +u.total_descuento_almuerzo.toFixed(2),
              total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
              total_extra_diurna: +u.total_extra_diurna.toFixed(2),
              total_extra_nocturna: +u.total_extra_nocturna.toFixed(2),
              total_extra_festiva: +u.total_extra_festiva.toFixed(2),
              total_horas_extras: +u.total_horas_extras.toFixed(2)
            };
          })
          .sort((a, b) => a.nombre_operador.localeCompare(b.nombre_operador));

        const totalMes = resumenPorMes[mesAnio].totales;

        const wsResumen = workbook.addWorksheet(nombreHoja);

        const resumenColumns = profileConfig.sheetSummaryColumns;
        wsResumen.mergeCells(`A1:${String.fromCharCode(64 + resumenColumns.length)}1`);
        wsResumen.getCell('A1').value = `RESUMEN DE HORAS - ${profileConfig.label.toUpperCase()} - ${nombreMes.toUpperCase()} ${anio}`;
        wsResumen.getCell('A1').font = { bold: true, size: 14 };
        wsResumen.getCell('A1').alignment = { horizontal: 'center' };
        if (profileConfig.summaryNote) {
          wsResumen.mergeCells(`A2:${String.fromCharCode(64 + resumenColumns.length)}2`);
          wsResumen.getCell('A2').value = profileConfig.summaryNote;
          wsResumen.getCell('A2').font = { italic: true, size: 9 };
          wsResumen.getCell('A2').alignment = { horizontal: 'center' };
        }

        wsResumen.addTable({
          name: `TablaResumen_${mesAnio.replace('-', '_')}`,
          ref: profileConfig.summaryNote ? 'A4' : 'A3',
          headerRow: true,
          totalsRow: false,
          style: { theme: 'TableStyleMedium2', showRowStripes: true },
          columns: resumenColumns.map(c => ({ name: c.label, filterButton: true })),
          rows: resumenUsuarios.map(u => resumenColumns.map(c => u[c.key] ?? ''))
        });

        const totalRow = (profileConfig.summaryNote ? 5 : 4) + resumenUsuarios.length;
        wsResumen.getRow(totalRow).values = reportProfile === 'gruas'
          ? [
              'TOTAL MES', '',
              resumenUsuarios.reduce((acc, u) => acc + u.total_dias_trabajados, 0),
              +totalMes.horas_trabajadas.toFixed(2),
              +totalMes.jornada_normal_0600_1600.toFixed(2),
              +totalMes.hed.toFixed(2),
              +totalMes.hen.toFixed(2),
              +totalMes.rn.toFixed(2),
              +totalMes.fest.toFixed(2),
              +totalMes.rfn.toFixed(2),
              +totalMes.hedf.toFixed(2),
              +totalMes.henf.toFixed(2),
              +totalMes.total_extras_pago.toFixed(2)
            ]
          : [
              'TOTAL MES', '',
              resumenUsuarios.reduce((acc, u) => acc + u.total_dias_trabajados, 0),
              +totalMes.horas_brutas.toFixed(2),
              +totalMes.descuento_almuerzo.toFixed(2),
              +totalMes.horas_trabajadas.toFixed(2),
              +totalMes.extra_diurna.toFixed(2),
              +totalMes.extra_nocturna.toFixed(2)
            ];
        wsResumen.getRow(totalRow).font = { bold: true };
        wsResumen.getRow(totalRow).eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9EAF7' } }; });

        resumenColumns.forEach((column, index) => { wsResumen.getColumn(index + 1).width = Math.min(30, Math.max(12, (column.width || 24) / 2)); });
      }
      const ws = workbook.addWorksheet('Registros Detallados');
      if (rows.length > 0) {
        const detailColumns = profileConfig.sheetDetailColumns;
        const spanishRows = rows.map((row) => ({
          ...buildSpanishDetailRowByProfile(row, reportProfile),
          __row_kind: row.row_kind || (row.audit_within_range === false ? 'audit_attempt' : 'valid')
        }));
        ws.addTable({
          name: 'TablaRegistrosDetallados',
          ref: 'A1',
          headerRow: true,
          totalsRow: false,
          style: { theme: 'TableStyleMedium2', showRowStripes: true },
          columns: detailColumns.map(c => ({ name: c.label, filterButton: true })),
          rows: spanishRows.map(r => detailColumns.map(c => {
            let val = r[c.label];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') { try { return JSON.stringify(val); } catch(e) { return String(val); } }
            return val;
          }))
        });
        detailColumns.forEach((column, i) => {
          ws.getColumn(i + 1).width = Math.min(60, Math.max(12, column.label.replace(/_/g, ' ').length + 4));
        });
        const detailStartRow = 2;
        spanishRows.forEach((row, index) => {
          if (row.__row_kind !== 'audit_attempt') return;
          const excelRow = ws.getRow(detailStartRow + index);
          excelRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F2' } };
            cell.font = { ...(cell.font || {}), color: { argb: '9F1239' } };
          });
        });
      }
      res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition','attachment; filename=horas_jornada.xlsx');
      await workbook.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      if (!rows || rows.length === 0) return res.status(404).json({ success:false, error:'No se encontraron registros' });
      const fileName = 'horas_jornada_compilado.pdf';
      res.setHeader('Content-Type','application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false });
      doc.on('error', (err) => {
        console.error('PDF generation error:', err);
        try { res.status(500).end(); } catch (_) {}
      });
      doc.pipe(res);

      const periodLabel = `Período: ${start || 'Inicio'} al ${end}`;

      const summaryColumns = profileConfig.pdfSummaryColumns;
      const detailColumns = profileConfig.pdfDetailColumns;

      const resumenMesList = Object.keys(resumenPorMes).sort();
      const detalleMesMap = new Map();
      for (const row of rows) {
        const mesKey = String(row?.fecha_servicio || '').slice(0, 7);
        if (!mesKey || mesKey.length < 7) continue;
        if (!detalleMesMap.has(mesKey)) detalleMesMap.set(mesKey, []);
        detalleMesMap.get(mesKey).push(row);
      }
      const detalleMesList = Array.from(detalleMesMap.keys()).sort();

      drawReportCoverPage(doc, {
        sectionLabel: 'LA CENTRAL',
        title: `Resumen de horas extras - ${profileConfig.label}`,
        subtitle: profileConfig.summaryNote,
        periodLabel
      });

      if (resumenMesList.length === 0) {
        drawLandscapeTableSection(doc, {
          sectionTitle: `Resumen de horas por trabajador - ${profileConfig.label}`,
          subtitle: periodLabel,
          note: profileConfig.summaryNote,
          columns: summaryColumns,
          rows: [],
          emptyMessage: 'No hay jornadas válidas para mostrar en el resumen.'
        });
      } else {
        for (const mesAnio of resumenMesList) {
          const [anio, mes] = mesAnio.split('-');
          const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;

          const resumenUsuarios = Object.values(resumenPorMes[mesAnio].usuarios)
            .map(({ _diasSet, ...u }) => {
              if (reportProfile === 'gruas') {
                return {
                  ...u,
                  rol: u.rol || u.cargo || '',
                  total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
                  jornada_normal_0600_1600: +u.jornada_normal_0600_1600.toFixed(2),
                  hed: +u.hed.toFixed(2),
                  hen: +u.hen.toFixed(2),
                  rn: +u.rn.toFixed(2),
                  fest: +u.fest.toFixed(2),
                  rfn: +u.rfn.toFixed(2),
                  hedf: +u.hedf.toFixed(2),
                  henf: +u.henf.toFixed(2),
                  total_horas_extras: +u.total_horas_extras.toFixed(2),
                  total_extras_pago: +u.total_extras_pago.toFixed(2),
                  desglose_pago: u.desglose_pago || buildPaymentBreakdownLabel({
                    jornada_normal_0600_1600: u.jornada_normal_0600_1600,
                    hed: u.hed,
                    hen: u.hen,
                    rn: u.rn,
                    fest: u.fest,
                    rfn: u.rfn,
                    hedf: u.hedf,
                    henf: u.henf
                  })
                };
              }
              return {
                ...u,
                rol: u.rol || u.cargo || '',
                total_horas_trabajadas: +u.total_horas_trabajadas.toFixed(2),
                total_extra_diurna: +u.total_extra_diurna.toFixed(2),
                total_extra_nocturna: +u.total_extra_nocturna.toFixed(2),
                total_extra_festiva: +u.total_extra_festiva.toFixed(2),
                total_horas_extras: +u.total_horas_extras.toFixed(2)
              };
            }).sort((a, b) => a.nombre_operador.localeCompare(b.nombre_operador));

          drawLandscapeTableSection(doc, {
            sectionTitle: `Resumen de horas - ${profileConfig.label} - ${nombreMes} ${anio}`,
            subtitle: `Operadores con jornadas válidas registradas en ${nombreMes} ${anio}.`,
            note: profileConfig.summaryNote,
            columns: summaryColumns,
            rows: resumenUsuarios,
            emptyMessage: `No hay jornadas válidas para ${nombreMes} ${anio}.`
          });
        }
      }

      drawReportCoverPage(doc, {
        sectionLabel: profileConfig.label.toUpperCase(),
        title: `Detalle de registros y auditoría - ${profileConfig.label}`,
        subtitle: profileConfig.detailNote,
        periodLabel
      });

      if (detalleMesList.length === 0) {
        drawLandscapeTableSection(doc, {
          sectionTitle: `Detalle de registros - ${profileConfig.label}`,
          subtitle: periodLabel,
          note: profileConfig.detailNote,
          columns: detailColumns,
          rows: [],
          emptyMessage: 'No hay registros detallados para mostrar.'
        });
      } else {
        for (const mesAnio of detalleMesList) {
          const [anio, mes] = mesAnio.split('-');
          const nombreMes = nombresMeses[parseInt(mes, 10)] || mes;
          const detalleRows = detalleMesMap.get(mesAnio) || [];
          const detailExportRows = detalleRows.map((row) => ({
            ...buildSpanishDetailRowByProfile(row, reportProfile),
            __row_kind: row.row_kind || (row.audit_within_range === false ? 'audit_attempt' : 'valid')
          }));

          drawLandscapeTableSection(doc, {
            sectionTitle: `Detalle de registros - ${profileConfig.label} - ${nombreMes} ${anio}`,
            subtitle: `Eventos válidos e inválidos asociados a ${nombreMes} ${anio}.`,
            note: profileConfig.detailNote,
            columns: detailColumns,
            rows: detailExportRows,
            emptyMessage: `No hay registros detallados para ${nombreMes} ${anio}.`,
            rowStyleResolver: (row) => (row.__row_kind === 'audit_attempt'
              ? { fill: '#fff1f2', stroke: '#fda4af', textColor: '#9f1239' }
              : null)
          });
        }
      }

      doc.end();
      return;
    }

    // CSV fallback
    const detailColumns = profileConfig.sheetDetailColumns;
    const exportRows = rows.map((row) => buildSpanishDetailRowByProfile(row, reportProfile));
    const header = detailColumns.map((column) => column.label);
    const lines = [header.join(',')];
    for (const r of exportRows) {
      const rowArr = header.map(k => {
        let val = r[k];
        if (val === null || val === undefined) val = '';
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

async function handleStartHorasExtraPdfJob(req, res) {
  try {
    db = ensureDb();
    const pool = db;
    const job = createReportJobRecord();
    const reportProfile = resolveAdminHorasExtraProfile(req);
    const { nombre, obra, constructora, empresa_id, empresa_ids, fecha_inicio, fecha_fin, limit = 50000 } = req.body || {};
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
      [...values, Math.min(50000, parseInt(limit, 10) || 50000)]
    );

    updateReportJob(job.jobId, {
      status: 'pending',
      message: q.rowCount === 0
        ? 'No hay registros para generar el PDF.'
        : 'El reporte fue encolado correctamente.'
    });

    res.status(202).json({
      success: true,
      jobId: job.jobId,
      status: q.rowCount === 0 ? 'error' : 'pending',
      message: q.rowCount === 0
        ? 'No hay registros para generar el PDF.'
        : 'El PDF se está generando en segundo plano.',
      downloadUrl: null,
      statusUrl: `/administrador/admin_horas_extra/pdf-jobs/${job.jobId}`,
      pdfRequestedAt: new Date().toISOString()
    });

    if (q.rowCount === 0) {
      finalizeReportJob(job.jobId, 'error', 'No hay registros para generar el PDF.');
      return;
    }

    const requestLike = {
      ...req,
      body: {
        ...(req.body || {}),
        formato: 'pdf'
      }
    };
    setImmediate(() => {
      void processHorasExtraPdfJob(job.jobId, requestLike);
    });
  } catch (err) {
    console.error('Error iniciando job de horas extra:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function handleGetHorasExtraPdfJob(req, res) {
  try {
    const job = getReportJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'El job no existe o ya expiró.'
      });
    }

    return res.json({
      success: true,
      ...normalizeReportJobRecord(job)
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function handleDownloadHorasExtraPdfJob(req, res) {
  try {
    const job = getReportJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'El job no existe o ya expiró.'
      });
    }

    if (job.status !== 'ready' || !job.filePath || !fs.existsSync(job.filePath)) {
      return res.status(409).json({
        success: false,
        jobId: job.jobId,
        status: job.status,
        message: job.status === 'error'
          ? job.message
          : 'El PDF todavía no está listo.',
        downloadUrl: job.status === 'ready' ? getReportJobDownloadUrl(job.jobId) : null
      });
    }

    res.download(job.filePath, job.fileName || 'horas_jornada_compilado.pdf', (err) => {
      if (err) {
        console.error('Error descargando PDF de job:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: err.message });
        }
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
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
    const sedeMap = await buildSedeMap(pool);
    const empresaMap = await buildEmpresaMap(pool);
    const cierreLocationMap = await buildCierreLocationMap(pool, q.rows.map(r => r.id));
    const reportProfile = resolveAdminHorasExtraProfile(req);
    const rows = enrichReportRows(
      await buildCombinedReportRows(pool, q.rows, sedeMap, cierreLocationMap, reportProfile),
      empresaMap
    ).map((row) => buildProfileReportRow(row, reportProfile));
    return res.json({ success: true, count: q.rowCount, rows });
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

router.post("/pdf-jobs", handleStartHorasExtraPdfJob);
router.post("/administrador/admin_horas_extra/pdf-jobs", handleStartHorasExtraPdfJob);
router.get("/pdf-jobs/:jobId", handleGetHorasExtraPdfJob);
router.get("/administrador/admin_horas_extra/pdf-jobs/:jobId", handleGetHorasExtraPdfJob);
router.get("/pdf-jobs/:jobId/download", handleDownloadHorasExtraPdfJob);
router.get("/administrador/admin_horas_extra/pdf-jobs/:jobId/download", handleDownloadHorasExtraPdfJob);

export default router;

