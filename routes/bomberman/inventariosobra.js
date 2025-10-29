import { Router } from "express";
const router = Router();

// Middleware: verifica disponibilidad de la DB
router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST: guarda un registro de inventario de obra
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos obligatorios (renombrados según petición)
  const required = [
    "nombre_cliente", "nombre_proyecto", "fecha_servicio", "nombre_operador", "cargo",
    "bola_limpieza_tuberia_55_cifa", "jostick", "inyector_grasa", "caja_herramientas", "tubo_entrega_50cm_flanche_plano",
    "caneca_5_galones", "caneca_55_galones", "pimpinas_5_6_galones", "manguera_bicolor", "juego_llaves_x3_piezas",
    "pinza_picolor", "bristol_14mm", "bristol_12mm", "juego_llaves_bristol_x9", "cortafrio", "pinzas_punta",
    "llave_expansiva_15", "maseta", "tubo_para_abrazadera", "llave_11", "llave_10", "llave_13", "llave_14", "llave_17",
    "llave_19", "llave_22", "llave_24", "llave_27", "llave_30", "llave_32", "destornillador_pala_65x125mm",
    "destornillador_pala_8x150mm", "destornillador_pala_55x125mm", "destornillador_estrella_ph3x150mm",
    "destornillador_estrella_ph2x100mm", "destornillador_estrella_ph3x75mm", "cunete_grasa_5_galones",
    "bomba_concreto_pc506_309_cifa_estado", "bomba_concreto_pc506_309_cifa_observacion",
    "bomba_concreto_pc607_411_cifa_estado", "bomba_concreto_pc607_411_cifa_observacion",
    "bomba_concreto_tb30_turbosol_estado", "bomba_concreto_tb30_turbosol_observacion",
    "bomba_concreto_tb50_turbosol_estado", "bomba_concreto_tb50_turbosol_observacion",
    "tubo_3mt_flanche_plano_estado", "tubo_3mt_flanche_plano_observacion",
    "tubo_2mt_flanche_plano_estado", "tubo_2mt_flanche_plano_observacion",
    "tubo_1mt_flanche_plano_estado", "tubo_1mt_flanche_plano_observacion",
    "abrazadera_3_pulg_flanche_plano_estado", "abrazadera_3_pulg_flanche_plano_observacion",
    "empaque_3_pulg_flanche_plano_estado", "empaque_3_pulg_flanche_plano_observacion",
    "abrazadera_4_pulg_flanche_plano_estado", "abrazadera_4_pulg_flanche_plano_observacion",
    "empaque_4_pulg_flanche_plano_estado", "empaque_4_pulg_flanche_plano_observacion",
    "abrazadera_5_pulg_flanche_plano_estado", "abrazadera_5_pulg_flanche_plano_observacion",
    "empaque_5_pulg_flanche_plano_estado", "empaque_5_pulg_flanche_plano_observacion",
    "codo_45_r1000_5_pulg_flanche_estado", "codo_45_r1000_5_pulg_flanche_observacion",
    "codo_90_r500_5_pulg_flanche_estado", "codo_90_r500_5_pulg_flanche_observacion",
    "codo_salida_6_pulg_turbosol_estado", "codo_salida_6_pulg_turbosol_observacion",
    "manguera_3_pulg_x10mt_estado", "manguera_3_pulg_x10mt_observacion",
    "manguera_5_pulg_x6mt_estado", "manguera_5_pulg_x6mt_observacion",
    "reduccion_5_a_4_pulg_estado", "reduccion_5_a_4_pulg_observacion",
    "valvula_guillotina_55_estado", "valvula_guillotina_55_observacion",
    "extintor_estado", "extintor_observacion",
    "botiquin_estado", "botiquin_observacion",
    "observaciones_generales"
  ];
  const faltantes = required.filter(k => body[k] === undefined || body[k] === null);
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  // Normalización de campos tipo opción (estado)
  const estadoFields = new Set([
    "bomba_concreto_pc506_309_cifa_estado", "bomba_concreto_pc607_411_cifa_estado", "bomba_concreto_tb30_turbosol_estado",
    "bomba_concreto_tb50_turbosol_estado", "tubo_3mt_flanche_plano_estado", "tubo_2mt_flanche_plano_estado",
    "tubo_1mt_flanche_plano_estado", "abrazadera_3_pulg_flanche_plano_estado", "empaque_3_pulg_flanche_plano_estado",
    "abrazadera_4_pulg_flanche_plano_estado", "empaque_4_pulg_flanche_plano_estado", "abrazadera_5_pulg_flanche_plano_estado",
    "empaque_5_pulg_flanche_plano_estado", "codo_45_r1000_5_pulg_flanche_estado", "codo_90_r500_5_pulg_flanche_estado",
    "codo_salida_6_pulg_turbosol_estado", "manguera_3_pulg_x10mt_estado", "manguera_5_pulg_x6mt_estado",
    "reduccion_5_a_4_pulg_estado", "valvula_guillotina_55_estado", "extintor_estado", "botiquin_estado"
  ]);
  function normalizeEstado(val) {
    if (val === undefined || val === null) return "BUENA";
    if (typeof val === "string") {
      const s = val.trim().toUpperCase();
      if (["BUENA", "MALA"].includes(s)) return s;
      if (["B", "GOOD"].includes(s)) return "BUENA";
      if (["M", "BAD"].includes(s)) return "MALA";
      return "BUENA";
    }
    return "BUENA";
  }

  // Normaliza los campos de estado
  required.forEach(f => {
    if (estadoFields.has(f) && body[f] !== undefined) {
      body[f] = normalizeEstado(body[f]);
    }
  });

  const fields = required;
  const values = fields.map(f => body[f]);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");

  try {
    const query = `INSERT INTO inventario_obra (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Inventario de obra guardado", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar inventario_obra:", error);
    return res.status(500).json({ error: "Error al guardar inventario_obra", detalle: error.message });
  }
});

// GET: lista los registros de inventario de obra (últimos 200 por defecto)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM inventario_obra ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener inventario_obra:", error);
    return res.status(500).json({ error: "Error al obtener inventario_obra", detalle: error.message });
  }
});

export default router;
