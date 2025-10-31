import express from "express";
const router = express.Router();

// GET /admin_usuarios/listar?empresa_id=1&offset=0&limit=10&busqueda=Juan
router.get("/listar", async (req, res) => {
  try {
    const pool = global.db;
    const { empresa_id = 1, offset = 0, limit = 10, busqueda = "" } = req.query;
    let where = "WHERE empresa_id = $1";
    let values = [empresa_id];
    if (busqueda) {
      where += " AND LOWER(nombre) LIKE $2";
      values.push(`%${busqueda.toLowerCase()}%`);
    }
    const q = await pool.query(
      `SELECT id, nombre, empresa_id, numero_identificacion, activo FROM trabajadores ${where} ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    // Total para paginación
    const totalQ = await pool.query(
      `SELECT COUNT(*) FROM trabajadores WHERE empresa_id = $1${busqueda ? " AND LOWER(nombre) LIKE $2" : ""}`,
      busqueda ? [empresa_id, `%${busqueda.toLowerCase()}%`] : [empresa_id]
    );
    res.json({ success: true, total: Number(totalQ.rows[0].count), trabajadores: q.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /admin_usuarios/agregar
router.post("/agregar", async (req, res) => {
  try {
    const pool = global.db;
    const { nombre, empresa_id, numero_identificacion, activo } = req.body;
    if (!nombre || !empresa_id || !numero_identificacion) {
      return res.status(400).json({ success: false, error: "Faltan datos obligatorios" });
    }
    const q = await pool.query(
      `INSERT INTO trabajadores (nombre, empresa_id, numero_identificacion, activo)
       VALUES ($1, $2, $3, $4) RETURNING id, nombre, empresa_id, numero_identificacion, activo`,
      [nombre, empresa_id, numero_identificacion, !!activo]
    );
    res.json({ success: true, trabajador: q.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /admin_usuarios/estado/:id
router.patch("/estado/:id", async (req, res) => {
  try {
    const pool = global.db;
    const { id } = req.params;
    const { activo } = req.body;
    if (typeof activo !== "boolean") {
      return res.status(400).json({ success: false, error: "activo debe ser booleano" });
    }
    const q = await pool.query(
      `UPDATE trabajadores SET activo = $1 WHERE id = $2 RETURNING id, nombre, activo`,
      [activo, id]
    );
    if (q.rows.length === 0) return res.status(404).json({ success: false, error: "Trabajador no encontrado" });
    res.json({ success: true, trabajador: q.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
