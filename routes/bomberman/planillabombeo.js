import { Router } from "express";
const router = Router();

// Middleware: responde inmediatamente si la DB no está lista
router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de planillabombeo");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

function formatTime(value) {
  // Si ya está en formato HH:MM o HH:MM:SS, lo retorna igual
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value;
  // Si es solo hora (ej: "8" o "15"), lo convierte a "08:00"
  if (/^\d{1,2}$/.test(value)) return value.padStart(2, "0") + ":00";
  // Si es hora y minutos sin separador (ej: "804"), lo convierte a "08:04"
  if (/^\d{3,4}$/.test(value)) {
    let h = value.length === 3 ? value.slice(0,1) : value.slice(0,2);
    let m = value.length === 3 ? value.slice(1) : value.slice(2);
    return h.padStart(2, "0") + ":" + m.padStart(2, "0");
  }
  return value; // Si no coincide, lo retorna igual (puede fallar en SQL)
}

// POST /bomberman/planillabombeo
router.post("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en POST /bomberman/planillabombeo");
    return res.status(500).json({ error: "DB no disponible" });
  }
  let {
    nombre_cliente,
    nombre_proyecto,
    fecha_servicio,
    bomba_numero,
    hora_llegada_obra,
    hora_salida_obra,
    hora_inicio_acpm, // ahora numérico
    hora_final_acpm,  // ahora numérico
    horometro_inicial,
    horometro_final,
    nombre_operador,
    nombre_auxiliar,
    total_metros_cubicos_bombeados
  } = req.body;

  // Formatear solo los campos TIME correctos
  hora_llegada_obra = formatTime(hora_llegada_obra);
  hora_salida_obra = formatTime(hora_salida_obra);

  // Validar parámetros obligatorios
  if (
    !nombre_cliente || !nombre_proyecto || !fecha_servicio || !bomba_numero ||
    !hora_llegada_obra || !hora_salida_obra ||
    hora_inicio_acpm == null || hora_final_acpm == null ||
    horometro_inicial == null || horometro_final == null ||
    !nombre_operador || !nombre_auxiliar || total_metros_cubicos_bombeados == null
  ) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }

  try {
    await db.query(
      `INSERT INTO planillaBombeo 
        (nombre_cliente, nombre_proyecto, fecha_servicio, bomba_numero, hora_llegada_obra, hora_salida_obra, hora_inicio_acpm, hora_final_acpm, horometro_inicial, horometro_final, nombre_operador, nombre_auxiliar, total_metros_cubicos_bombeados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        nombre_cliente,
        nombre_proyecto,
        fecha_servicio,
        bomba_numero,
        hora_llegada_obra,
        hora_salida_obra,
        hora_inicio_acpm,
        hora_final_acpm,
        horometro_inicial,
        horometro_final,
        nombre_operador,
        nombre_auxiliar,
        total_metros_cubicos_bombeados
      ]
    );
    res.json({ message: "Registro guardado correctamente" });
  } catch (error) {
    console.error("Error al guardar el registro:", error);
    res.status(500).json({ error: "Error al guardar el registro", detalle: error.message, sql: error.position ? error : undefined });
  }
});

// GET /bomberman/planillabombeo
router.get("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en GET /bomberman/planillabombeo");
    return res.status(500).json({ error: "DB no disponible" });
  }
  try {
    const result = await db.query(`SELECT * FROM planillaBombeo`);
    res.json({ registros: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros", detalle: error.message });
  }
});

export default router;
