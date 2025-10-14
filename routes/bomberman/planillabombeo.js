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
    galones_inicio_acpm,
    galones_final_acpm,
    galones_pinpina, // <-- nuevo campo
    horometro_inicial,
    horometro_final,
    nombre_operador,
    nombre_auxiliar,
    total_metros_cubicos_bombeados,
    remisiones // <-- ahora se espera un array de remisiones
  } = req.body;

  // Formatear solo los campos TIME correctos
  hora_llegada_obra = formatTime(hora_llegada_obra);
  hora_salida_obra = formatTime(hora_salida_obra);

  // Validar parámetros obligatorios
  if (
    !nombre_cliente || !nombre_proyecto || !fecha_servicio || !bomba_numero ||
    !hora_llegada_obra || !hora_salida_obra ||
    galones_inicio_acpm == null || galones_final_acpm == null ||
    galones_pinpina == null || // <-- validación nuevo campo
    horometro_inicial == null || horometro_final == null ||
    !nombre_operador || !nombre_auxiliar || total_metros_cubicos_bombeados == null ||
    !Array.isArray(remisiones) || remisiones.length === 0
  ) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios o remisiones no es un array válido" });
  }

  try {
    // 1. Insertar la planilla de bombeo
    const result = await db.query(
      `INSERT INTO planilla_bombeo 
        (nombre_cliente, nombre_proyecto, fecha_servicio, bomba_numero, hora_llegada_obra, hora_salida_obra, galones_inicio_acpm, galones_final_acpm, galones_pinpina, horometro_inicial, horometro_final, nombre_operador, nombre_auxiliar, total_metros_cubicos_bombeados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        nombre_cliente,
        nombre_proyecto,
        fecha_servicio,
        bomba_numero,
        hora_llegada_obra,
        hora_salida_obra,
        galones_inicio_acpm,
        galones_final_acpm,
        galones_pinpina, // <-- nuevo campo
        horometro_inicial,
        horometro_final,
        nombre_operador,
        nombre_auxiliar,
        total_metros_cubicos_bombeados
      ]
    );
    const planillaId = result.rows[0].id;

    // 2. Insertar cada remisión asociada
    for (const rem of remisiones) {
      const {
        remision,
        hora_llegada,
        hora_inicial,
        hora_final,
        metros,
        observaciones,
        manguera // <-- nuevo campo
      } = rem;

      // Formatear los campos TIME de la remisión
      const hora_llegada_fmt = formatTime(hora_llegada);
      const hora_inicial_fmt = formatTime(hora_inicial);
      const hora_final_fmt = formatTime(hora_final);

      // Validar campos de la remisión
      if (
        !remision || !hora_llegada || !hora_inicial || !hora_final || metros == null || !manguera 
      ) {
        return res.status(400).json({ error: "Faltan campos obligatorios en una remisión" });
      }

      await db.query(
        `INSERT INTO remisiones 
          (planilla_bombeo_id, remision, hora_llegada, hora_inicial, hora_final, metros, observaciones, manguera)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          planillaId,
          remision,
          hora_llegada_fmt,
          hora_inicial_fmt,
          hora_final_fmt,
          metros,
          observaciones ?? "",
          manguera
        ]
      );
    }

    res.json({ message: "Registro guardado correctamente", planilla_bombeo_id: planillaId });
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
    // Obtener todas las planillas
    const result = await db.query(`SELECT * FROM planilla_bombeo`);
    const planillas = result.rows;

    // Obtener todas las remisiones asociadas, incluyendo manguera
    const remisionesResult = await db.query(`SELECT * FROM remisiones`);
    const remisiones = remisionesResult.rows;

    // Asociar remisiones a cada planilla
    const planillasConRemisiones = planillas.map(planilla => ({
      ...planilla,
      remisiones: remisiones
        .filter(r => r.planilla_bombeo_id === planilla.id)
        .map(r => ({
          ...r,
          manguera: r.manguera // asegúrate que el campo esté presente
        }))
    }));

    res.json({ registros: planillasConRemisiones });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros", detalle: error.message });
  }
});

export default router;
