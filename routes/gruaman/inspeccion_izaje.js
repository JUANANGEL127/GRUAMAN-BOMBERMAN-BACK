import { Router } from "express";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
const router = Router();

// Middleware: verifica disponibilidad de la DB
router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST: guarda un registro de inspección de izaje (estructura actualizada)
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos obligatorios según la nueva estructura
  const required = [
    "nombre_cliente", "nombre_proyecto", "fecha_servicio", "nombre_operador", "cargo",
    "modelo_grua", "altura_gancho",
    "balde_concreto1_buen_estado", "balde_concreto1_mecanismo_apertura", "balde_concreto1_soldadura", "balde_concreto1_estructura", "balde_concreto1_aseo",
    "balde_concreto2_buen_estado", "balde_concreto2_mecanismo_apertura", "balde_concreto2_soldadura", "balde_concreto2_estructura", "balde_concreto2_aseo",
    "balde_escombro_buen_estado", "balde_escombro_mecanismo_apertura", "balde_escombro_soldadura", "balde_escombro_estructura",
    "canasta_material_buen_estado", "canasta_material_malla_seguridad_intacta", "canasta_material_espadas", "canasta_material_soldadura",
    "eslinga_cadena_ramales", "eslinga_cadena_grilletes", "eslinga_cadena_tornillos",
    "eslinga_sintetica_textil", "eslinga_sintetica_costuras", "eslinga_sintetica_etiquetas",
    "grillete_perno_danos", "grillete_cuerpo_buen_estado"
  ];
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  // Campos tipo opción según la nueva estructura
  const optionFields = new Set([
    "balde_concreto1_buen_estado", "balde_concreto1_mecanismo_apertura", "balde_concreto1_soldadura", "balde_concreto1_estructura", "balde_concreto1_aseo",
    "balde_concreto2_buen_estado", "balde_concreto2_mecanismo_apertura", "balde_concreto2_soldadura", "balde_concreto2_estructura", "balde_concreto2_aseo",
    "balde_escombro_buen_estado", "balde_escombro_mecanismo_apertura", "balde_escombro_soldadura", "balde_escombro_estructura",
    "canasta_material_buen_estado", "canasta_material_malla_seguridad_intacta", "canasta_material_espadas", "canasta_material_soldadura",
    "eslinga_cadena_ramales", "eslinga_cadena_grilletes", "eslinga_cadena_tornillos",
    "eslinga_sintetica_textil", "eslinga_sintetica_costuras", "eslinga_sintetica_etiquetas",
    "grillete_perno_danos", "grillete_cuerpo_buen_estado"
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
    "modelo_grua","altura_gancho",
    "marca_balde_concreto1","serial_balde_concreto1","capacidad_balde_concreto1",
    "balde_concreto1_buen_estado","balde_concreto1_mecanismo_apertura","balde_concreto1_soldadura","balde_concreto1_estructura","balde_concreto1_aseo",
    "marca_balde_concreto2","serial_balde_concreto2","capacidad_balde_concreto2",
    "balde_concreto2_buen_estado","balde_concreto2_mecanismo_apertura","balde_concreto2_soldadura","balde_concreto2_estructura","balde_concreto2_aseo",
    "marca_balde_escombro","serial_balde_escombro","capacidad_balde_escombro",
    "balde_escombro_buen_estado","balde_escombro_mecanismo_apertura","balde_escombro_soldadura","balde_escombro_estructura",
    "marca_canasta_material","serial_canasta_material","capacidad_canasta_material",
    "canasta_material_buen_estado","canasta_material_malla_seguridad_intacta","canasta_material_espadas","canasta_material_soldadura",
    "numero_eslinga_cadena","capacidad_eslinga_cadena",
    "eslinga_cadena_ramales","eslinga_cadena_grilletes","eslinga_cadena_tornillos",
    "serial_eslinga_sintetica","capacidad_eslinga_sintetica",
    "eslinga_sintetica_textil","eslinga_sintetica_costuras","eslinga_sintetica_etiquetas",
    "serial_grillete","capacidad_grillete",
    "grillete_perno_danos","grillete_cuerpo_buen_estado",
    "observaciones"
  ];

  const values = fields.map(f => {
    const v = body[f];
    if (optionFields.has(f)) return normalizeOption(v);
    return v !== undefined ? v : null;
  });

  const placeholders = fields.map((_,i) => `$${i+1}`).join(", ");

  try {
    const query = `INSERT INTO inspeccion_izaje (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Inspección de izaje guardada", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar inspeccion_izaje:", error);
    return res.status(500).json({ error: "Error al guardar inspeccion_izaje", detalle: error.message });
  }
});

// GET: lista los registros de inspección de izaje (últimos 200 por defecto)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM inspeccion_izaje ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener inspeccion_izaje:", error);
    return res.status(500).json({ error: "Error al obtener inspeccion_izaje", detalle: error.message });
  }
});

export default router;
