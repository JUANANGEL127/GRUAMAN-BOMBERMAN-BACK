import { Router } from "express";
const router = Router();

const ITEMS = [
  "detergente_polvo", "jabon_rey", "espatula_flexible", "grasa_litio",
  "aceite_hidraulico", "plastico_grueso", "talonario_bombeo", "extintor",
  "botiquin", "grasera", "manguera_inyector_grasa", "radio",
  "auricular", "pimpina_acpm", "bola_limpieza", "perros", "guaya"
];

// Middleware: verifica disponibilidad de la DB
router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST: guarda un registro de kit de limpieza
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  // Campos obligatorios: datos generales
  const required = [
    "nombre_cliente", "nombre_proyecto", "fecha_servicio",
    "nombre_operador", "bomba_numero"
  ];

  // Validar campos requeridos
  const faltantes = required.filter(k => body[k] === undefined || body[k] === null);
  if (faltantes.length) {
    return res.status(400).json({ error: "Faltan campos requeridos", faltantes });
  }

  function normalizeInteger(val) {
    if (val === undefined || val === null || val === '') return 0;
    const parsed = parseInt(val, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  // Construir campos y valores
  const fields = [...required];
  const values = required.map(f => body[f]);

  // Agregar campos _buena, _mala y _estado de cada item
  for (const base of ITEMS) {
    const buena = `${base}_buena`;
    const mala  = `${base}_mala`;
    const estado = `${base}_estado`;

    fields.push(buena);
    values.push(normalizeInteger(body[buena]));

    fields.push(mala);
    values.push(normalizeInteger(body[mala]));

    fields.push(estado);
    const estadoVal = body[estado];
    values.push(estadoVal === undefined || estadoVal === null ? '' : String(estadoVal).trim());
  }

  // Campo observaciones (opcional)
  if (body.observaciones !== undefined) {
    fields.push("observaciones");
    values.push(body.observaciones === null ? null : String(body.observaciones).trim());
  }

  const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");

  try {
    const query = `INSERT INTO kit_limpieza (${fields.join(", ")}) VALUES (${placeholders}) RETURNING id`;
    const result = await db.query(query, values);
    return res.json({ ok: true, id: result.rows[0].id });
  } catch (error) {
    console.error("Error al guardar kit_limpieza:", error);
    return res.status(500).json({ error: "Error al guardar kit_limpieza", detalle: error.message });
  }
});

// GET: lista los últimos 200 registros
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const result = await db.query(
      `SELECT * FROM kit_limpieza ORDER BY created_at DESC LIMIT 200`
    );
    return res.json({ registros: result.rows });
  } catch (error) {
    console.error("Error al obtener kit_limpieza:", error);
    return res.status(500).json({ error: "Error al obtener kit_limpieza", detalle: error.message });
  }
});

export default router;
