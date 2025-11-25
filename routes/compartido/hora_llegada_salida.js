import express from "express";
import { DateTime } from "luxon";
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
// Body esperado: { nombre_operador, fecha_servicio, hora_salida, minutos_almuerzo }
router.post("/salida", async (req, res) => {
  const { nombre_operador, fecha_servicio, hora_salida, minutos_almuerzo } = req.body || {};

  if (!nombre_operador || !fecha_servicio || !hora_salida || minutos_almuerzo === undefined) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios: nombre_operador, fecha_servicio, hora_salida, minutos_almuerzo" });
  }

  if (typeof minutos_almuerzo === "number" && (minutos_almuerzo < 0 || minutos_almuerzo > 240)) {
    return res.status(400).json({ error: "minutos_almuerzo debe ser un número entre 0 y 240" });
  }

  try {
    const fechaDia = normalizeFechaToBogota(fecha_servicio);
    if (!fechaDia) return res.status(400).json({ error: "fecha_servicio inválida" });

    // Buscar por fecha (solo día) para encontrar el registro correspondiente
    // la tabla puede no tener columna 'id', solo necesitamos hora_ingreso aquí
    const existe = await db.query(
      "SELECT hora_ingreso FROM horas_jornada WHERE nombre_operador = $1 AND CAST(fecha_servicio AS date) = $2::date",
      [nombre_operador, fechaDia]
    );
    if (existe.rows.length === 0) {
      return res.status(404).json({ error: "No existe registro de ingreso para ese operador y fecha" });
    }

    await db.query(
      `UPDATE horas_jornada
       SET hora_salida = $1, minutos_almuerzo = $2
       WHERE nombre_operador = $3 AND CAST(fecha_servicio AS date) = $4::date`,
      [hora_salida, minutos_almuerzo, nombre_operador, fechaDia]
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
