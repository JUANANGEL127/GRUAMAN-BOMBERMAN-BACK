import { Router } from "express";
import { formatDateOnly } from '../../helpers/dateUtils.js';
const router = Router();

// Middleware: verifica disponibilidad de la DB
router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST: guarda un registro de herramientas de mantenimiento
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos obligatorios: datos generales + cantidades buena/mala de los 16 items
  const required = [
    // Datos generales
    "nombre_cliente", "nombre_proyecto", "fecha_servicio", "nombre_operador", "bomba_numero",

    // Items (buena/mala)
    "copa_bristol_10mm_buena", "copa_bristol_10mm_mala",
    "extension_media_x12_a_buena", "extension_media_x12_a_mala",
    "palanca_media_x15_buena", "palanca_media_x15_mala",
    "llave_bristol_14_buena", "llave_bristol_14_mala",
    "llave_11_buena", "llave_11_mala",
    "llave_12_buena", "llave_12_mala",
    "llave_13_buena", "llave_13_mala",
    "llave_14_buena", "llave_14_mala",
    "llave_19_buena", "llave_19_mala",
    "destornillador_pala_buena", "destornillador_pala_mala",
    "destornillador_estrella_buena", "destornillador_estrella_mala",
    "copa_punta_10_media_buena", "copa_punta_10_media_mala",
    "extension_media_x12_b_buena", "extension_media_x12_b_mala",
    "rachet_media_buena", "rachet_media_mala",
    "llave_mixta_17_buena", "llave_mixta_17_mala",
    "llave_expansiva_15_buena", "llave_expansiva_15_mala"
  ];

  // Campos opcionales: empresa_id, observaciones y todos los _estado
  const optional = [
    "empresa_id",
    "observaciones",
    "copa_bristol_10mm_estado",
    "extension_media_x12_a_estado",
    "palanca_media_x15_estado",
    "llave_bristol_14_estado",
    "llave_11_estado",
    "llave_12_estado",
    "llave_13_estado",
    "llave_14_estado",
    "llave_19_estado",
    "destornillador_pala_estado",
    "destornillador_estrella_estado",
    "copa_punta_10_media_estado",
    "extension_media_x12_b_estado",
    "rachet_media_estado",
    "llave_mixta_17_estado",
    "llave_expansiva_15_estado"
  ];

  // Validar campos requeridos
  const faltantes = required.filter(k => body[k] === undefined || body[k] === null);
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  // Campos de tipo entero (cantidades buena/mala)
  const integerFields = new Set(required.filter(f => f.endsWith('_buena') || f.endsWith('_mala')));

  function normalizeInteger(val) {
    if (val === undefined || val === null || val === '') return 0;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  // Preparar campos y valores para la inserción (campos requeridos)
  const fields = [...required];
  const values = required.map(f => {
    if (integerFields.has(f)) return normalizeInteger(body[f]);
    return body[f];
  });

  // Campos _estado: siempre incluirlos como string vacío si no llegaron
  const estadoFields = new Set([
    "copa_bristol_10mm_estado", "extension_media_x12_a_estado", "palanca_media_x15_estado",
    "llave_bristol_14_estado", "llave_11_estado", "llave_12_estado", "llave_13_estado",
    "llave_14_estado", "llave_19_estado", "destornillador_pala_estado",
    "destornillador_estrella_estado", "copa_punta_10_media_estado", "extension_media_x12_b_estado",
    "rachet_media_estado", "llave_mixta_17_estado", "llave_expansiva_15_estado"
  ]);

  optional.forEach(f => {
    if (estadoFields.has(f)) {
      fields.push(f);
      const val = body[f];
      values.push(val === undefined || val === null ? '' : String(val).trim());
      return;
    }
    if (f === 'empresa_id') {
      if (body[f] !== undefined) {
        fields.push(f);
        values.push(body[f] ? parseInt(body[f], 10) : null);
      }
      return;
    }
    if (body[f] !== undefined) {
      fields.push(f);
      values.push(body[f] === null ? null : String(body[f]).trim());
    }
  });

  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");

  try {
    const query = `INSERT INTO herramientas_mantenimiento (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ message: "Herramientas de mantenimiento guardadas", id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar herramientas_mantenimiento:", error);
    return res.status(500).json({ error: "Error al guardar herramientas_mantenimiento", detalle: error.message });
  }
});

// GET: lista los registros (últimos 200 por defecto)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const limit = parseInt(req.query.limit) || 200;
    const result = await db.query(`SELECT * FROM herramientas_mantenimiento ORDER BY id DESC LIMIT $1`, [limit]);
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener herramientas_mantenimiento:", error);
    return res.status(500).json({ error: "Error al obtener herramientas_mantenimiento", detalle: error.message });
  }
});

export default router;
