import { Router } from "express";
const router = Router();

// Verifica disponibilidad de la DB
router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// Inserta un permiso de trabajo; el front debe enviar los campos tal como en la tabla
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos mínimos requeridos (solo datos esenciales)
  const required = ["nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo"];
  // Considerar cadena vacía como faltante (trim)
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  // Normalizar herramientas_seleccionadas: acepta array o string
  let herramientas = body.herramientas_seleccionadas;
  if (Array.isArray(herramientas)) herramientas = herramientas.join(", ");
  if (herramientas === undefined) herramientas = null;

  // Campos que deben contener 'SI' | 'NO' | 'NA' según el CHECK de la tabla
  const optionFields = new Set([
    "trabajo_rutinario","tarea_en_alturas",
    "certificado_alturas","seguridad_social_arl","casco_tipo1","gafas_seguridad","proteccion_auditiva","proteccion_respiratoria",
    "guantes_seguridad","botas_punta_acero","ropa_reflectiva",
    "arnes_cuerpo_entero","arnes_cuerpo_entero_dielectico","mosqueton","arrestador_caidas","eslinga_absorbedor","eslinga_posicionamiento",
    "linea_vida","eslinga_doble","verificacion_anclaje",
    "procedimiento_charla","medidas_colectivas_prevencion","epp_epcc_buen_estado","equipos_herramienta_buen_estado","inspeccion_sistema",
    "plan_emergencia_rescate","medidas_caida","kit_rescate","permisos","condiciones_atmosfericas","distancia_vertical_caida",
    "vertical_fija","vertical_portatil","andamio_multidireccional","andamio_colgante","elevador_carga","canasta","ascensores"
  ]);

  // Normaliza valores a 'SI'|'NO'|'NA'
  function normalizeOption(val) {
    if (val === undefined || val === null) return "NA";
    if (typeof val === "boolean") return val ? "SI" : "NO";
    if (typeof val === "number") return val === 1 ? "SI" : (val === 0 ? "NO" : "NA");
    if (typeof val === "string") {
      const s = val.trim().toLowerCase();
      if (["si","s","yes","y","1"].includes(s)) return "SI";
      if (["no","n","not","0"].includes(s)) return "NO";
      if (s === "" || ["na","n/a","none","null","undefined"].includes(s)) return "NA";
      // si viene algún texto fuera de lo esperado, devolver 'NA' para no violar constraint
      return "NA";
    }
    return "NA";
  }

  const fields = [
    "nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo",
    "trabajo_rutinario","tarea_en_alturas","altura_inicial","altura_final",
    "herramientas_seleccionadas","herramientas_otros",
    "certificado_alturas","seguridad_social_arl","casco_tipo1","gafas_seguridad","proteccion_auditiva","proteccion_respiratoria",
    "guantes_seguridad","botas_punta_acero","ropa_reflectiva",
    "arnes_cuerpo_entero","arnes_cuerpo_entero_dielectico","mosqueton","arrestador_caidas","eslinga_absorbedor","eslinga_posicionamiento",
    "linea_vida","eslinga_doble","verificacion_anclaje",
    "procedimiento_charla","medidas_colectivas_prevencion","epp_epcc_buen_estado","equipos_herramienta_buen_estado","inspeccion_sistema",
    "plan_emergencia_rescate","medidas_caida","kit_rescate","permisos","condiciones_atmosfericas","distancia_vertical_caida","otro_precausiones",
    "vertical_fija","vertical_portatil","andamio_multidireccional","andamio_colgante","elevador_carga","canasta","ascensores","otro_equipos",
    "observaciones","motivo_suspension","nombre_suspende","nombre_responsable","nombre_coordinador"
  ];

  // Construir valores aplicando normalización para campos tipo opción
  const values = fields.map(f => {
    if (f === "herramientas_seleccionadas") return herramientas;
    const v = body[f];
    if (optionFields.has(f)) return normalizeOption(v);
    return v !== undefined ? v : null;
  });

  const placeholders = fields.map((_,i) => `$${i+1}`).join(", ");

  try {
    const query = `INSERT INTO permiso_trabajo (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Permiso guardado", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar permiso_trabajo:", error);
    return res.status(500).json({ error: "Error al guardar permiso_trabajo", detalle: error.message });
  }
});

// Lista los permisos guardados (últimos 200 por defecto)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM permiso_trabajo ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener permiso_trabajo:", error);
    return res.status(500).json({ error: "Error al obtener permiso_trabajo", detalle: error.message });
  }
});

export default router;
