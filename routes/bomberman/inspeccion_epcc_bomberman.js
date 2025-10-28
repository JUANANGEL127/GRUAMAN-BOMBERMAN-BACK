import { Router } from "express";
const router = Router();

router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST: inserta registro
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos obligatorios
  const required = [
    "cliente_constructora", "proyecto_constructora", "fecha_registro", "nombre_operador", "cargo_operador",
    "sintoma_malestar_fisico", "uso_medicamentos_que_afecten_alerta", "consumo_sustancias_12h", "condiciones_fisicas_tareas_criticas",
    "competencia_vigente_tarea_critica", "proteccion_cabeza_buen_estado", "proteccion_auditiva_buen_estado",
    "proteccion_visual_buen_estado", "proteccion_respiratoria_buen_estado", "guantes_proteccion_buen_estado",
    "ropa_trabajo_buen_estado", "botas_seguridad_buen_estado", "otros_epp_buen_estado",
    "etiqueta_en_buen_estado", "compatibilidad_sistema_proteccion", "absorbedor_impacto_buen_estado",
    "cintas_tiras_buen_estado", "costuras_buen_estado", "indicadores_impacto_buen_estado",
    "partes_metalicas_buen_estado", "sistema_cierre_automatico_buen_estado", "palanca_multifuncional_buen_funcionamiento",
    "estrias_leva_libres_dano", "partes_plasticas_buen_estado", "guarda_cabos_funda_alma_buen_estado",
    "herramientas_libres_danos_visibles", "mangos_facil_agarre", "herramientas_afiladas_ajustadas",
    "herramientas_disenadas_tarea", "herramientas_dimensiones_correctas", "seguetas_bien_acopladas",
    "pinzas_buen_funcionamiento", "aislamiento_dieletrico_buen_estado", "apaga_equipo_para_cambio_discos",
    "uso_llaves_adecuadas_cambio_discos", "discos_brocas_puntas_buen_estado", "rpm_no_supera_capacidad_disco",
    "cables_aislamiento_doble_buen_estado", "conexiones_neumaticas_seguras", "mangueras_y_equipos_sin_fugas",
    "piezas_ajustadas_correctamente", "tubo_escape_con_guarda_silenciador", "guayas_pasadores_buen_estado",
    "observaciones_generales"
  ];
  const faltantes = required.filter(k => body[k] === undefined || body[k] === null);
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  // Normalización de campos tipo opción (SI/NO/NA)
  const optionFields = new Set(required.filter(k => k !== "cliente_constructora" && k !== "proyecto_constructora" && k !== "fecha_registro" && k !== "nombre_operador" && k !== "cargo_operador" && k !== "observaciones_generales"));
  function normalizeOption(val) {
    if (val === undefined || val === null) return "NA";
    if (typeof val === "string") {
      const s = val.trim().toUpperCase();
      if (["SI", "NO", "NA"].includes(s)) return s;
      if (["S", "YES", "Y", "1"].includes(s)) return "SI";
      if (["N", "NO", "0"].includes(s)) return "NO";
      return "NA";
    }
    if (typeof val === "boolean") return val ? "SI" : "NO";
    if (typeof val === "number") return val === 1 ? "SI" : (val === 0 ? "NO" : "NA");
    return "NA";
  }
  required.forEach(f => {
    if (optionFields.has(f) && body[f] !== undefined) {
      body[f] = normalizeOption(body[f]);
    }
  });

  const fields = required;
  const values = fields.map(f => body[f]);
  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");

  try {
    const query = `INSERT INTO inspeccion_epcc_bomberman (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Inspección EPCC Bomberman guardada", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar inspeccion_epcc_bomberman:", error);
    return res.status(500).json({ error: "Error al guardar inspeccion_epcc_bomberman", detalle: error.message });
  }
});

// GET: lista los registros (últimos 200 por defecto)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM inspeccion_epcc_bomberman ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener inspeccion_epcc_bomberman:", error);
    return res.status(500).json({ error: "Error al obtener inspeccion_epcc_bomberman", detalle: error.message });
  }
});

export default router;
