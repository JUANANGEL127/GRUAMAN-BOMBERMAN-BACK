import { Router } from "express";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
const router = Router();

// Middleware: verifica disponibilidad de la DB
router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST: guarda un registro de chequeo en alturas
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos obligatorios
  const required = ["nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo"];
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  // Campos tipo opción
  const optionFields = new Set([
    "sintomas_fisicos","medicamento","consumo_sustancias","condiciones_fisicas_mentales",
    "lugar_trabajo_demarcado","inspeccion_medios_comunicacion","equipo_demarcado_seguro","base_libre_empozamiento",
    "iluminacion_trabajos_nocturnos","uso_adecuado_epp_epcc","uso_epp_trabajadores","epcc_adecuado_riesgo",
    "interferencia_otros_trabajos","observacion_continua_trabajadores",
    "punto_anclaje_definido","inspeccion_previa_sistema_acceso",
    "plan_izaje_cumple_programa","inspeccion_elementos_izaje","limpieza_elementos_izaje","auxiliar_piso_asignado",
    "consignacion_circuito","circuitos_identificados","cinco_reglas_oro","trabajo_con_tension_protocolo",
    "informacion_riesgos_trabajadores","distancias_minimas_seguridad","tablero_libre_elementos_riesgo","cables_en_buen_estado"
  ]);
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

  const fields = [
    "nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo",
    "sintomas_fisicos","medicamento","consumo_sustancias","condiciones_fisicas_mentales",
    "lugar_trabajo_demarcado","inspeccion_medios_comunicacion","equipo_demarcado_seguro","base_libre_empozamiento",
    "iluminacion_trabajos_nocturnos","uso_adecuado_epp_epcc","uso_epp_trabajadores","epcc_adecuado_riesgo",
    "interferencia_otros_trabajos","observacion_continua_trabajadores",
    "punto_anclaje_definido","inspeccion_previa_sistema_acceso",
    "plan_izaje_cumple_programa","inspeccion_elementos_izaje","limpieza_elementos_izaje","auxiliar_piso_asignado",
    "consignacion_circuito","circuitos_identificados","cinco_reglas_oro","trabajo_con_tension_protocolo",
    "informacion_riesgos_trabajadores","distancias_minimas_seguridad","tablero_libre_elementos_riesgo","cables_en_buen_estado",
    "observaciones"
  ];

  const values = fields.map(f => {
    const v = body[f];
    if (optionFields.has(f)) return normalizeOption(v);
    return v !== undefined ? v : null;
  });

  const placeholders = fields.map((_,i) => `$${i+1}`).join(", ");

  try {
    const query = `INSERT INTO chequeo_alturas (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Chequeo en alturas guardado", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar chequeo_alturas:", error);
    return res.status(500).json({ error: "Error al guardar chequeo_alturas", detalle: error.message });
  }
});

// GET: lista los registros de chequeo en alturas (últimos 200 por defecto)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM chequeo_alturas ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener chequeo_alturas:", error);
    return res.status(500).json({ error: "Error al obtener chequeo_alturas", detalle: error.message });
  }
});

export default router;
