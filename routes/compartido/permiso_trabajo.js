import { Router } from "express";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
const router = Router();

router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

/**
 * Normaliza un valor verdadero/falso a la restricción "SI" | "NO" | "NA" esperada por la BD.
 * Maneja variantes booleanas, numéricas (1/0) y de cadena.
 * @param {*} val
 * @returns {"SI"|"NO"|"NA"}
 */
function normalizeOption(val) {
  if (val === undefined || val === null) return "NA";
  if (typeof val === "boolean") return val ? "SI" : "NO";
  if (typeof val === "number") return val === 1 ? "SI" : (val === 0 ? "NO" : "NA");
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["si","s","yes","y","1"].includes(s)) return "SI";
    if (["no","n","not","0"].includes(s)) return "NO";
    if (s === "" || ["na","n/a","none","null","undefined"].includes(s)) return "NA";
    return "NA";
  }
  return "NA";
}

/**
 * POST /compartido/permiso_trabajo
 * Inserta un registro de permiso de trabajo.
 * Los campos de tipo opción se convierten a "SI" | "NO" | "NA" independientemente de su formato de origen.
 * @body {{ nombre_cliente: string, nombre_proyecto: string, fecha_servicio: string, nombre_operador: string, cargo: string, [field: string]: any }}
 * @returns {{ message: string, id: number }}
 * @throws {400} Si faltan campos requeridos.
 */
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  const required = ["nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo"];
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  let herramientas = body.herramientas_seleccionadas;
  if (Array.isArray(herramientas)) herramientas = herramientas.join(", ");
  if (herramientas === undefined) herramientas = null;

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

/**
 * GET /compartido/permiso_trabajo
 * Retorna los registros de permiso de trabajo más recientes.
 * @query {number} [limit=200] - Número máximo de registros a retornar.
 * @returns {{ registros: Array }}
 */
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
