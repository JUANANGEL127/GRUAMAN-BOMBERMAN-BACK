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
 * POST /gruaman/inspeccion_epcc
 * Inserta un registro de inspección de equipo de protección personal contra caídas (EPCC).
 * @body {{ nombre_cliente: string, nombre_proyecto: string, fecha_servicio: string, nombre_operador: string, cargo: string, arnes: string, arrestador_caidas: string, mosqueton: string, eslinga_posicionamiento: string, eslinga_y_absorbedor: string, linea_vida: string, [field: string]: any }}
 * @returns {{ message: string, id: number }}
 * @throws {400} Si faltan campos requeridos.
 */
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  const required = [
    "nombre_cliente", "nombre_proyecto", "fecha_servicio", "nombre_operador", "cargo",
    "arnes", "arrestador_caidas", "mosqueton", "eslinga_posicionamiento", "eslinga_y_absorbedor", "linea_vida"
  ];
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  const optionFields = new Set([
    "arnes", "arrestador_caidas", "mosqueton", "eslinga_posicionamiento", "eslinga_y_absorbedor", "linea_vida"
  ]);

  const fields = [
    "nombre_cliente","nombre_proyecto","fecha_servicio","nombre_operador","cargo",
    "serial_arnes","serial_arrestador","serial_mosqueton","serial_posicionamiento","serial_eslinga_y","serial_linea_vida",
    "arnes","arrestador_caidas","mosqueton","eslinga_posicionamiento","eslinga_y_absorbedor","linea_vida",
    "observaciones"
  ];

  const values = fields.map(f => {
    const v = body[f];
    if (optionFields.has(f)) return normalizeOption(v);
    return v !== undefined ? v : null;
  });

  const placeholders = fields.map((_,i) => `$${i+1}`).join(", ");

  try {
    const query = `INSERT INTO inspeccion_epcc (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Inspección EPCC guardada", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar inspeccion_epcc:", error);
    return res.status(500).json({ error: "Error al guardar inspeccion_epcc", detalle: error.message });
  }
});

/**
 * GET /gruaman/inspeccion_epcc
 * Retorna los registros de inspección EPCC más recientes.
 * @query {number} [limit=200]
 * @returns {{ registros: Array }}
 */
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM inspeccion_epcc ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener inspeccion_epcc:", error);
    return res.status(500).json({ error: "Error al obtener inspeccion_epcc", detalle: error.message });
  }
});

export default router;
