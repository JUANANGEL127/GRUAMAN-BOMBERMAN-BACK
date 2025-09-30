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

// POST /bomberman/planillabombeo
router.post("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en POST /bomberman/planillabombeo");
    return res.status(500).json({ error: "DB no disponible" });
  }
  // Extraer los parámetros usando los nombres correctos del payload
  const {
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
  } = req.body;

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
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    console.error("Error al guardar el registro:", error); // Log completo en consola
    res.status(500).json({ error: "Error al guardar el registro", detalle: error.message });
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
    const [rows] = await db.query(`SELECT * FROM planillaBombeo`);
    res.json({ registros: rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros" });
  }
});

export default router;
