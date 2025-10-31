import express from "express";
const router = express.Router();

// GET /admin_obras/listar?empresa_id=2&offset=0&limit=10&busqueda=La Pepita
router.get("/listar", async (req, res) => {
  try {
    const pool = global.db;
    const { empresa_id = 2, offset = 0, limit = 10, busqueda = "" } = req.query;
    let where = "WHERE empresa_id = $1";
    let values = [empresa_id];
    if (busqueda) {
      where += " AND LOWER(nombre_obra) LIKE $2";
      values.push(`%${busqueda.toLowerCase()}%`);
    }
    const q = await pool.query(
      `SELECT id, nombre_obra, empresa_id, latitud, longitud, constructora, activa FROM obras ${where} ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    const totalQ = await pool.query(
      `SELECT COUNT(*) FROM obras WHERE empresa_id = $1${busqueda ? " AND LOWER(nombre_obra) LIKE $2" : ""}`,
      busqueda ? [empresa_id, `%${busqueda.toLowerCase()}%`] : [empresa_id]
    );
    res.json({ success: true, total: Number(totalQ.rows[0].count), obras: q.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin_obras/agregar
router.post("/agregar", async (req, res) => {
  try {
    const pool = global.db;
    const { nombre_obra, empresa_id, latitud, longitud, constructora, activa } = req.body;
    if (!nombre_obra || !empresa_id || !latitud || !longitud || !constructora) {
      return res.status(400).json({ success: false, error: "Faltan datos obligatorios" });
    }
    const q = await pool.query(
      `INSERT INTO obras (nombre_obra, empresa_id, latitud, longitud, constructora, activa)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre_obra, empresa_id, latitud, longitud, constructora, activa`,
      [nombre_obra, empresa_id, latitud, longitud, constructora, activa !== false]
    );
    res.json({ success: true, obra: q.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /admin_obras/estado/:id
router.patch("/estado/:id", async (req, res) => {
  try {
    const pool = global.db;
    const { id } = req.params;
    const { activa } = req.body;
    if (typeof activa !== "boolean") {
      return res.status(400).json({ success: false, error: "activa debe ser booleano" });
    }
    const q = await pool.query(
      `UPDATE obras SET activa = $1 WHERE id = $2 RETURNING id, nombre_obra, activa`,
      [activa, id]
    );
    if (q.rows.length === 0) return res.status(404).json({ success: false, error: "Obra no encontrada" });
    res.json({ success: true, obra: q.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
