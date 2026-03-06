import { Router } from "express";
const router = Router();

router.use((req, res, next) => {
  if (!global.db) return res.status(503).json({ error: "DB no disponible" });
  next();
});

// POST /sst/pqr — guarda una nueva PQR
router.post("/", async (req, res) => {
  const db = global.db;
  const body = req.body || {};

  const required = ["nombre_cliente", "nombre_proyecto", "fecha_servicio", "nombre_operador", "nombre_director", "area", "pqr"];
  const faltantes = required.filter(k => {
    const v = body[k];
    return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  });
  if (faltantes.length) return res.status(400).json({ error: "Faltan campos requeridos", faltantes });

  try {
    const result = await db.query(
      `INSERT INTO pqr (nombre_cliente, nombre_proyecto, fecha_servicio, nombre_operador, nombre_director, area, pqr)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        body.nombre_cliente.trim(),
        body.nombre_proyecto.trim(),
        body.fecha_servicio,
        body.nombre_operador.trim(),
        body.nombre_director.trim(),
        body.area.trim(),
        body.pqr.trim(),
      ]
    );
    return res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error("[PQR] Error insertando:", err);
    return res.status(500).json({ error: "Error guardando PQR", detalle: err.message });
  }
});

// GET /sst/pqr — lista todas las PQR (para administración futura)
router.get("/", async (req, res) => {
  const db = global.db;
  try {
    const result = await db.query(`SELECT * FROM pqr ORDER BY fecha_servicio DESC, id DESC`);
    return res.json({ pqr: result.rows });
  } catch (err) {
    console.error("[PQR] Error consultando:", err);
    return res.status(500).json({ error: "Error consultando PQR" });
  }
});

export default router;
