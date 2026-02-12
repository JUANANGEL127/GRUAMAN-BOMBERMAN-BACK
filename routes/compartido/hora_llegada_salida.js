import express from "express";
import { DateTime } from "luxon";
import cron from "node-cron";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
const router = express.Router();

// Usa global.db para compatibilidad con index.js
let db;
try {
  db = global.db;
  if (!db) throw new Error("global.db no está definido");
} catch (e) {
  console.error("Error: global.db no está definido. Asegúrate de importar este router después de inicializar la base de datos en index.js.");
  throw e;
}

const CRON_TIMEZONE = 'America/Bogota';

// Calcula hora_salida = hora_ingreso + 7h20min (7.33 horas)
function calcularHoraSalida(horaIngreso) {
  const str = String(horaIngreso ?? '').slice(0, 5); // "HH:MM"
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

// Completar horas de salida faltantes para una fecha.
// Para cada operador: toma el PRIMER registro sin salida (menor hora_ingreso) y le suma 7h20min.
async function completarSalidasParaFecha(fecha) {
  const fechaStr = fecha || DateTime.now().setZone(CRON_TIMEZONE).minus({ days: 1 }).toISODate();
  // Primer registro sin salida de cada operador ese día (ORDER BY hora_ingreso ASC, LIMIT 1 por operador)
  const { rows } = await db.query(
    `SELECT DISTINCT ON (h.nombre_operador) h.id, h.nombre_operador, h.hora_ingreso, h.fecha_servicio
     FROM horas_jornada h
     WHERE CAST(h.fecha_servicio AS date) = $1::date
       AND (h.hora_salida IS NULL OR h.hora_salida::text = '')
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

// 12:00am (medianoche) - Completar horas de salida faltantes del día anterior
// Para cada operador: completa el PRIMER registro sin salida del día con hora_ingreso + 7h20min
cron.schedule('0 0 * * *', async () => {
  try {
    const ayer = DateTime.now().setZone(CRON_TIMEZONE).minus({ days: 1 }).toISODate();
    const { fecha, actualizados } = await completarSalidasParaFecha(ayer);
    console.log(`[CRON 00:00] Completadas ${actualizados.length} salidas para ${fecha}`);
    actualizados.forEach(a => console.log(`  - ${a.nombre_operador} (id: ${a.id}): ${a.hora_ingreso} -> ${a.hora_salida}`));
  } catch (err) {
    console.error("[CRON 00:00] Error en cron de completar salidas:", err.message);
  }
}, { timezone: CRON_TIMEZONE });

// Al iniciar (o al despertar del servidor): completar salidas pendientes de ayer y anteayer.
// Si el servidor estuvo dormido a medianoche, el cron no corrió; al despertar esto lo corrige.
(function ejecutarCompletarSalidasAlIniciar() {
  const delayMs = 8000; // dar tiempo a que la DB y el app estén listos
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

// Normaliza la fecha de entrada a YYYY-MM-DD en zona America/Bogota
function normalizeFechaToBogota(fechaInput) {
  if (!fechaInput) return null;
  try {
    // DateTime.fromISO entiende timestamps con Z y también fechas simples YYYY-MM-DD
    const dt = DateTime.fromISO(String(fechaInput));
    if (!dt.isValid) {
      // intento parsear como Date nativo
      const d = new Date(fechaInput);
      if (isNaN(d.getTime())) return null;
      return DateTime.fromJSDate(d).setZone("America/Bogota").toISODate();
    }
    return dt.setZone("America/Bogota").toISODate(); // 'YYYY-MM-DD'
  } catch (e) {
    return null;
  }
}

// POST /horas_jornada/ingreso
// Body esperado: { nombre_cliente, nombre_proyecto, fecha_servicio, nombre_operador, cargo?, empresa_id, hora_ingreso }
router.post("/ingreso", async (req, res) => {
  const {
    nombre_cliente,
    nombre_proyecto,
    fecha_servicio,
    nombre_operador,
    cargo,
    empresa_id,
    hora_ingreso
  } = req.body || {};

  if (!nombre_cliente || !nombre_proyecto || !fecha_servicio || !nombre_operador || !empresa_id || !hora_ingreso) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios: nombre_cliente, nombre_proyecto, fecha_servicio, nombre_operador, empresa_id, hora_ingreso" });
  }

  try {
    const fechaDia = normalizeFechaToBogota(fecha_servicio);
    if (!fechaDia) return res.status(400).json({ error: "fecha_servicio inválida" });

    // Verificar si hay un registro abierto (sin hora de salida) para ese operador y fecha
    const registroAbierto = await db.query(
      `SELECT id, hora_ingreso FROM horas_jornada 
       WHERE nombre_operador = $1 
       AND CAST(fecha_servicio AS date) = $2::date 
       AND (hora_salida IS NULL OR hora_salida::text = '')`,
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

    // Crear nuevo registro de ingreso
    const result = await db.query(
      `INSERT INTO horas_jornada (
        nombre_cliente, nombre_proyecto, fecha_servicio, nombre_operador, cargo, empresa_id, hora_ingreso
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        nombre_cliente,
        nombre_proyecto,
        fechaDia, // guardamos la fecha normalizada (YYYY-MM-DD)
        nombre_operador,
        cargo || null,
        empresa_id,
        hora_ingreso
      ]
    );

    return res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    console.error("Error registrando ingreso:", err);
    return res.status(500).json({ error: "Error registrando ingreso", detalle: err.message });
  }
});

// POST /horas_jornada/salida
// Body esperado: { nombre_operador, fecha_servicio, hora_salida }
router.post("/salida", async (req, res) => {
  const { nombre_operador, fecha_servicio, hora_salida } = req.body || {};

  if (!nombre_operador || !fecha_servicio || !hora_salida) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios: nombre_operador, fecha_servicio, hora_salida" });
  }

  try {
    const fechaDia = normalizeFechaToBogota(fecha_servicio);
    if (!fechaDia) return res.status(400).json({ error: "fecha_servicio inválida" });

    // Buscar el último registro sin hora_salida para ese operador y fecha
    const registroPendiente = await db.query(
      `SELECT id, hora_ingreso FROM horas_jornada 
       WHERE nombre_operador = $1 
       AND CAST(fecha_servicio AS date) = $2::date 
       AND (hora_salida IS NULL OR hora_salida::text = '')
       ORDER BY hora_ingreso DESC 
       LIMIT 1`,
      [nombre_operador, fechaDia]
    );
    
    if (registroPendiente.rows.length === 0) {
      return res.status(404).json({ error: "No existe registro de ingreso pendiente (sin salida) para ese operador y fecha" });
    }

    const registroId = registroPendiente.rows[0].id;

    await db.query(
      `UPDATE horas_jornada
       SET hora_salida = $1
       WHERE id = $2`,
      [hora_salida, registroId]
    );

    return res.json({ success: true, id: registroId });
  } catch (err) {
    console.error("Error registrando salida:", err);
    return res.status(500).json({ error: "Error registrando salida", detalle: err.message });
  }
});

// POST /horas_jornada/completar-salidas - Completar salidas faltantes manualmente
// Body opcional: { fecha: "YYYY-MM-DD" } - si no se envía, usa ayer
// Útil para corregir datos cuando el cron no corrió o para fechas pasadas
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

// GET /horas_jornada - devuelve los últimos 100 registros (solo para verificar envío desde el front)
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
