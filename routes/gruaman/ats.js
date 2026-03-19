import { Router } from "express";
const router = Router();

router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

/**
 * POST /gruaman/ats
 * Inserta un nuevo registro ATS (Análisis de Trabajo Seguro).
 * Las columnas aceptadas se validan dinámicamente contra `information_schema` para evitar
 * inyección de campos desconocidos manteniendo la independencia del esquema.
 * @body {{ tipo_ats: string, lugar_obra: string, [field: string]: any }}
 * @returns {{ message: string, id: number }}
 * @throws {400} Si faltan campos requeridos o no se proporcionaron columnas válidas.
 */
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  const required = ["tipo_ats", "lugar_obra"];
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) {
    return res.status(400).json({ error: "Faltan campos requeridos", faltantes });
  }

  try {
    const colResult = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ats'`
    );
    const camposValidos = new Set(colResult.rows.map(r => r.column_name));

    const campos = Object.keys(body).filter(k => camposValidos.has(k) && k !== "id");
    const valores = campos.map(k => body[k]);
    const placeholders = campos.map((_, i) => `$${i + 1}`).join(", ");

    if (campos.length === 0) {
      return res.status(400).json({ error: "No se enviaron campos válidos" });
    }

    const result = await db.query(
      `INSERT INTO ats (${campos.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      valores
    );

    return res.json({ message: "ATS guardado correctamente", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar ATS:", error);
    return res.status(500).json({ error: "Error al guardar ATS", detalle: error.message });
  }
});

/**
 * GET /gruaman/ats
 * Retorna los registros ATS más recientes.
 * @query {number} [limit=200] - Número máximo de registros a retornar.
 * @returns {{ registros: Array }}
 */
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM ats ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener ATS:", error);
    return res.status(500).json({ error: "Error al obtener registros ATS", detalle: error.message });
  }
});

export default router;
