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

// 12:00am (medianoche) - Completar horas de salida faltantes del día anterior
cron.schedule('0 0 * * *', async () => {
  try {
    // Obtener la fecha de ayer en zona Colombia
    const ayer = DateTime.now().setZone(CRON_TIMEZONE).minus({ days: 1 }).toISODate();

    // Buscar registros del día anterior sin hora de salida
    const registrosSinSalida = await db.query(
      `SELECT nombre_operador, hora_ingreso, fecha_servicio 
       FROM horas_jornada 
       WHERE CAST(fecha_servicio AS date) = $1::date 
       AND (hora_salida IS NULL OR hora_salida::text = '')`,
      [ayer]
    );

    console.log(`[CRON 00:00] Encontrados ${registrosSinSalida.rows.length} registros sin hora de salida para ${ayer}`);

    for (const row of registrosSinSalida.rows) {
      try {
        // Calcular hora de salida = hora_ingreso + 7h20min (7.33 horas)
        const horaIngreso = String(row.hora_ingreso).slice(0, 5); // "HH:MM"
        const [hh, mm] = horaIngreso.split(':').map(Number);
        
        let salidaHoras = hh + 7;
        let salidaMinutos = mm + 20;
        
        if (salidaMinutos >= 60) {
          salidaHoras += 1;
          salidaMinutos -= 60;
        }
        if (salidaHoras >= 24) {
          salidaHoras -= 24;
        }
        
        const horaSalidaCalculada = `${String(salidaHoras).padStart(2, '0')}:${String(salidaMinutos).padStart(2, '0')}`;

        await db.query(
          `UPDATE horas_jornada 
           SET hora_salida = $1 
           WHERE nombre_operador = $2 AND CAST(fecha_servicio AS date) = $3::date`,
          [horaSalidaCalculada, row.nombre_operador, ayer]
        );

        console.log(`[CRON 00:00] Completada salida para ${row.nombre_operador}: ${horaIngreso} -> ${horaSalidaCalculada}`);
      } catch (updateErr) {
        console.error(`[CRON 00:00] Error actualizando salida para ${row.nombre_operador}:`, updateErr.message);
      }
    }
  } catch (err) {
    console.error("[CRON 00:00] Error en cron de completar salidas:", err.message);
  }
}, { timezone: CRON_TIMEZONE });

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

    // Verificar existencia por DÍA (no por timestamp completo) para evitar doble registro el mismo día
    const existe = await db.query(
      "SELECT 1 FROM horas_jornada WHERE nombre_operador = $1 AND CAST(fecha_servicio AS date) = $2::date",
      [nombre_operador, fechaDia]
    );
    if (existe.rows.length > 0) {
      return res.status(409).json({ error: "Ya existe registro de ingreso para ese operador y fecha" });
    }

    await db.query(
      `INSERT INTO horas_jornada (
        nombre_cliente, nombre_proyecto, fecha_servicio, nombre_operador, cargo, empresa_id, hora_ingreso
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
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

    return res.json({ success: true });
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

    // Buscar por fecha (solo día) para encontrar el registro correspondiente
    const existe = await db.query(
      "SELECT hora_ingreso FROM horas_jornada WHERE nombre_operador = $1 AND CAST(fecha_servicio AS date) = $2::date",
      [nombre_operador, fechaDia]
    );
    if (existe.rows.length === 0) {
      return res.status(404).json({ error: "No existe registro de ingreso para ese operador y fecha" });
    }

    await db.query(
      `UPDATE horas_jornada
       SET hora_salida = $1
       WHERE nombre_operador = $2 AND CAST(fecha_servicio AS date) = $3::date`,
      [hora_salida, nombre_operador, fechaDia]
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("Error registrando salida:", err);
    return res.status(500).json({ error: "Error registrando salida", detalle: err.message });
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
