import express from "express";
import { DateTime } from "luxon";
import cron from "node-cron";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
const router = express.Router();

/**
 * Proxy de BD diferido — resuelve global.db en el momento de la llamada para evitar capturar
 * una referencia al pool sin inicializar cuando el módulo se importa por primera vez.
 */
const db = {
  query: (...args) => {
    if (!global.db) throw new Error("global.db no está disponible");
    return global.db.query(...args);
  }
};

const CRON_TIMEZONE = 'America/Bogota';

/**
 * Conjunto de bloqueos en memoria para prevenir inserciones duplicadas de ingreso concurrentes
 * para la misma combinación de operador/fecha/hora.
 * @type {Set<string>}
 */
const _ingresoEnProceso = new Set();

/**
 * Calcula la hora de salida esperada como hora_ingreso + 7 h 20 min.
 * Retorna null si la entrada no puede parsearse como "HH:MM".
 * @param {string} horaIngreso - Cadena de hora en formato "HH:MM[:SS]".
 * @returns {string|null} Hora de salida en "HH:MM", o null en caso de fallo al parsear.
 */
function calcularHoraSalida(horaIngreso) {
  const str = String(horaIngreso ?? '').slice(0, 5);
  const [hh, mm] = str.split(':').map(Number);
  if (isNaN(hh) || isNaN(mm)) return null;
  let salidaHoras = hh + 7;
  let salidaMinutos = mm + 20;
  if (salidaMinutos >= 60) {
    salidaHoras += 1;
    salidaMinutos -= 60;
  }
  if (salidaHoras >= 24) salidaHoras -= 24;
  return `${String(salidaHoras).padStart(2, '0')}:${String(salidaMinutos).padStart(2, '0')}`;
}

/**
 * Completa las horas de salida faltantes para todos los operadores en una fecha dada.
 * Para cada operador, toma el registro abierto más antiguo (sin hora_salida) y
 * establece hora_salida = hora_ingreso + 7 h 20 min.
 * @param {string|null} fecha - Fecha "YYYY-MM-DD" a procesar; por defecto ayer.
 * @returns {Promise<{ fecha: string, actualizados: Array<{ id: number, nombre_operador: string, hora_ingreso: string, hora_salida: string }> }>}
 */
async function completarSalidasParaFecha(fecha) {
  const fechaStr = fecha || DateTime.now().setZone(CRON_TIMEZONE).minus({ days: 1 }).toISODate();
  const { rows } = await db.query(
    `SELECT DISTINCT ON (h.nombre_operador) h.id, h.nombre_operador, h.hora_ingreso, h.fecha_servicio
     FROM horas_jornada h
     WHERE h.fecha_servicio = $1::date
       AND h.hora_salida IS NULL
     ORDER BY h.nombre_operador, h.hora_ingreso ASC`,
    [fechaStr]
  );
  const actualizados = [];
  for (const row of rows) {
    const horaSalida = calcularHoraSalida(row.hora_ingreso);
    if (!horaSalida) continue;
    await db.query(
      `UPDATE horas_jornada SET hora_salida = $1 WHERE id = $2`,
      [horaSalida, row.id]
    );
    actualizados.push({
      id: row.id,
      nombre_operador: row.nombre_operador,
      hora_ingreso: row.hora_ingreso,
      hora_salida: horaSalida
    });
  }
  return { fecha: fechaStr, actualizados };
}

/**
 * Tarea programada: completa las horas de salida pendientes del día calendario anterior.
 * Se ejecuta diariamente a las 00:00 hora Colombia (05:00 UTC).
 */
cron.schedule('0 5 * * *', async () => {
  try {
    const ahora = DateTime.now().setZone(CRON_TIMEZONE);
    console.log(`[CRON] Ejecutando a las ${ahora.toFormat('yyyy-MM-dd HH:mm:ss')} (hora Bogotá)`);
    const ayer = ahora.minus({ days: 1 }).toISODate();
    const { fecha, actualizados } = await completarSalidasParaFecha(ayer);
    console.log(`[CRON 00:00] Completadas ${actualizados.length} salidas para ${fecha}`);
    actualizados.forEach(a => console.log(`  - ${a.nombre_operador} (id: ${a.id}): ${a.hora_ingreso} -> ${a.hora_salida}`));
  } catch (err) {
    console.error("[CRON 00:00] Error en cron de completar salidas:", err.message);
  }
});

/**
 * Recuperación al inicio: completa las horas de salida pendientes de ayer y anteayer.
 * Protege contra el caso en que el cron no se haya ejecutado mientras el servidor estuvo caído.
 * Se ejecuta 8 segundos después de cargar el módulo para permitir que el pool de BD se inicialice.
 */
(function ejecutarCompletarSalidasAlIniciar() {
  const delayMs = 8000;
  setTimeout(async () => {
    try {
      const hoy = DateTime.now().setZone(CRON_TIMEZONE);
      let total = 0;
      for (let diasAtras = 1; diasAtras <= 2; diasAtras++) {
        const fecha = hoy.minus({ days: diasAtras }).toISODate();
        const { actualizados } = await completarSalidasParaFecha(fecha);
        total += actualizados.length;
        if (actualizados.length > 0) {
          console.log(`[STARTUP] Completadas ${actualizados.length} salidas pendientes de ${fecha}`);
        }
      }
      if (total > 0) {
        console.log(`[STARTUP] Total: ${total} registros completados al despertar`);
      }
    } catch (e) {
      console.error("[STARTUP] Error completando salidas al iniciar:", e.message);
    }
  }, delayMs);
})();

/**
 * Extrae una cadena "YYYY-MM-DD" simple de cualquier entrada similar a fecha sin
 * introducir desfases de zona horaria. Retorna null si la entrada no puede parsearse.
 * @param {string|Date|null} fechaInput
 * @returns {string|null}
 */
function normalizeFechaToBogota(fechaInput) {
  if (!fechaInput) return null;
  try {
    const soloFecha = String(fechaInput).split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(soloFecha)) {
      return soloFecha;
    }

    const dt = DateTime.fromISO(String(fechaInput));
    if (dt.isValid) {
      return dt.toISODate();
    }

    const d = new Date(fechaInput);
    if (!isNaN(d.getTime())) {
      const year = d.getUTCFullYear();
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return null;
  } catch (e) {
    return null;
  }
}

/**
 * POST /horas_jornada/ingreso
 * Crea un nuevo registro de ingreso para un operador en una fecha de servicio dada.
 * Rechaza si ya existe un registro abierto (sin hora_salida) para ese par operador/fecha.
 * Un bloqueo en memoria previene condiciones de carrera en solicitudes duplicadas simultáneas.
 * @body {{ nombre_proyecto: string, fecha_servicio: string, nombre_operador: string, empresa_id: number, hora_ingreso: string, nombre_cliente?: string, cargo?: string, minutos_almuerzo?: number }}
 * @returns {{ success: boolean, id: number }}
 * @throws {400} Si faltan campos requeridos o fecha_servicio es inválida.
 * @throws {409} Si hay una inserción concurrente en progreso o ya existe un registro abierto.
 */
router.post("/ingreso", async (req, res) => {
  const {
    nombre_cliente,
    nombre_proyecto,
    fecha_servicio,
    nombre_operador,
    cargo,
    empresa_id,
    hora_ingreso,
    minutos_almuerzo
  } = req.body || {};

  if (!nombre_proyecto || !fecha_servicio || !nombre_operador || !empresa_id || !hora_ingreso) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios: nombre_proyecto, fecha_servicio, nombre_operador, empresa_id, hora_ingreso" });
  }

  const lockKey = `${nombre_operador}|${fecha_servicio}|${hora_ingreso}`;
  if (_ingresoEnProceso.has(lockKey)) {
    return res.status(409).json({ error: "Registro en proceso, por favor espera un momento." });
  }
  _ingresoEnProceso.add(lockKey);

  try {
    const fechaDia = normalizeFechaToBogota(fecha_servicio);
    if (!fechaDia) return res.status(400).json({ error: "fecha_servicio inválida" });

    const registroAbierto = await db.query(
      `SELECT id, hora_ingreso FROM horas_jornada
       WHERE nombre_operador = $1
       AND fecha_servicio = $2::date
       AND hora_salida IS NULL`,
      [nombre_operador, fechaDia]
    );

    if (registroAbierto.rows.length > 0) {
      return res.status(409).json({
        error: "Ya existe un registro de ingreso sin hora de salida. Debe registrar la salida antes de un nuevo ingreso.",
        registro_pendiente: {
          id: registroAbierto.rows[0].id,
          hora_ingreso: registroAbierto.rows[0].hora_ingreso
        }
      });
    }

    const result = await db.query(
      `INSERT INTO horas_jornada (
        nombre_cliente, nombre_proyecto, fecha_servicio, nombre_operador, cargo, empresa_id, hora_ingreso, minutos_almuerzo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id`,
      [
        nombre_cliente,
        nombre_proyecto,
        fechaDia,
        nombre_operador,
        cargo || null,
        empresa_id,
        hora_ingreso,
        minutos_almuerzo !== undefined && minutos_almuerzo !== null ? Number(minutos_almuerzo) : 60
      ]
    );

    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Error registrando ingreso:", err);
    return res.status(500).json({ error: "Error registrando ingreso", detalle: err.message });
  } finally {
    _ingresoEnProceso.delete(lockKey);
  }
});

/**
 * POST /horas_jornada/salida
 * Registra la hora de salida para el registro de ingreso abierto más reciente de un operador.
 * Selecciona el último registro abierto por hora_ingreso DESC.
 * @body {{ nombre_operador: string, fecha_servicio: string, hora_salida: string }}
 * @returns {{ success: boolean, id: number }}
 * @throws {400} Si faltan campos requeridos o fecha_servicio es inválida.
 * @throws {404} Si no existe un registro de ingreso abierto para ese operador/fecha.
 */
router.post("/salida", async (req, res) => {
  const { nombre_operador, fecha_servicio, hora_salida } = req.body || {};

  if (!nombre_operador || !fecha_servicio || !hora_salida) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios: nombre_operador, fecha_servicio, hora_salida" });
  }

  try {
    const fechaDia = normalizeFechaToBogota(fecha_servicio);
    if (!fechaDia) return res.status(400).json({ error: "fecha_servicio inválida" });

    const registroPendiente = await db.query(
      `SELECT id, hora_ingreso FROM horas_jornada
       WHERE nombre_operador = $1
       AND fecha_servicio = $2::date
       AND hora_salida IS NULL
       ORDER BY hora_ingreso DESC
       LIMIT 1`,
      [nombre_operador, fechaDia]
    );

    if (registroPendiente.rows.length === 0) {
      const debug = await db.query(
        `SELECT id, hora_ingreso, hora_salida FROM horas_jornada WHERE nombre_operador = $1 AND fecha_servicio = $2::date ORDER BY hora_ingreso ASC`,
        [nombre_operador, fechaDia]
      );
      console.warn(`[salida] No se encontró registro abierto. Operador: "${nombre_operador}", Fecha: "${fechaDia}". Registros del día: ${JSON.stringify(debug.rows)}`);
      return res.status(404).json({ error: "No existe un registro de entrada para guardar la hora de salida", fecha_buscada: fechaDia, operador: nombre_operador });
    }

    const registroId = registroPendiente.rows[0].id;

    await db.query(
      `UPDATE horas_jornada SET hora_salida = $1 WHERE id = $2`,
      [hora_salida, registroId]
    );

    return res.json({ success: true, id: registroId });
  } catch (err) {
    console.error("Error registrando salida:", err);
    return res.status(500).json({ error: "Error registrando salida", detalle: err.message });
  }
});

/**
 * POST /horas_jornada/completar-salidas
 * Dispara manualmente el relleno de horas de salida para una fecha dada.
 * Útil para corregir datos cuando el cron programado no se ejecutó.
 * @body {{ fecha?: string }} Fecha opcional "YYYY-MM-DD"; por defecto ayer.
 * @returns {{ success: boolean, fecha: string, actualizados: number, detalle: Array }}
 */
router.post("/completar-salidas", async (req, res) => {
  try {
    const fecha = req.body?.fecha ? normalizeFechaToBogota(req.body.fecha) : null;
    const { fecha: fechaProcesada, actualizados } = await completarSalidasParaFecha(fecha);
    return res.json({
      success: true,
      fecha: fechaProcesada,
      actualizados: actualizados.length,
      detalle: actualizados
    });
  } catch (err) {
    console.error("Error completando salidas:", err);
    return res.status(500).json({ error: "Error completando salidas", detalle: err.message });
  }
});

/**
 * GET /horas_jornada
 * Retorna los 100 registros de horas de jornada más recientes ordenados por fecha de servicio descendente.
 * @returns {{ count: number, rows: Array }}
 */
router.get("/", async (req, res) => {
  try {
    const q = await db.query(`SELECT * FROM horas_jornada ORDER BY fecha_servicio DESC LIMIT 100`);
    return res.json({ count: q.rowCount, rows: q.rows });
  } catch (err) {
    console.error("Error consultando horas_jornada:", err);
    return res.status(500).json({ error: "Error consultando registros", detalle: err.message });
  }
});

export default router;
