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
 * POST /gruaman/chequeo_torregruas
 * Inserta un registro de inspección diaria de torre grúa.
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

  const optionFields = new Set([
    "epp_personal","epp_contra_caidas","ropa_dotacion",
    "tornilleria_ajustada","anillo_arriostrador","soldaduras_buen_estado","base_buenas_condiciones",
    "funcionamiento_pito","cables_alimentacion","movimientos_maquina","cables_enrollamiento",
    "frenos_funcionando","poleas_dinamometrica","gancho_seguro","punto_muerto","mando_buen_estado",
    "baldes_buen_estado","canasta_materiales","estrobos_buen_estado","grilletes_buen_estado",
    "ayudante_amarre","radio_comunicacion"
  ]);

  const fields = [
    "nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo",
    "epp_personal","epp_contra_caidas","ropa_dotacion",
    "tornilleria_ajustada","anillo_arriostrador","soldaduras_buen_estado","base_buenas_condiciones",
    "funcionamiento_pito","cables_alimentacion","movimientos_maquina","cables_enrollamiento",
    "frenos_funcionando","poleas_dinamometrica","gancho_seguro","punto_muerto","mando_buen_estado",
    "baldes_buen_estado","canasta_materiales","estrobos_buen_estado","grilletes_buen_estado",
    "ayudante_amarre","radio_comunicacion",
    "observaciones"
  ];

  const values = fields.map(f => {
    const v = body[f];
    if (optionFields.has(f)) return normalizeOption(v);
    return v !== undefined ? v : null;
  });

  const placeholders = fields.map((_,i) => `$${i+1}`).join(", ");

  try {
    const query = `INSERT INTO chequeo_torregruas (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Chequeo de torre grúa guardado", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar chequeo_torregruas:", error);
    return res.status(500).json({ error: "Error al guardar chequeo_torregruas", detalle: error.message });
  }
});

/**
 * GET /gruaman/chequeo_torregruas
 * Retorna los registros de inspección de torre grúa más recientes.
 * @query {number} [limit=200]
 * @returns {{ registros: Array }}
 */
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM chequeo_torregruas ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener chequeo_torregruas:", error);
    return res.status(500).json({ error: "Error al obtener chequeo_torregruas", detalle: error.message });
  }
});

export default router;
