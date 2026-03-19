import express from "express";
const router = express.Router();

/**
 * GET /admin_obras/listar
 * Retorna una lista paginada y opcionalmente filtrada de obras para una empresa dada.
 * @query {number} [empresa_id=2]
 * @query {number} [offset=0]
 * @query {number} [limit=10]
 * @query {string} [busqueda] - Coincidencia parcial sin distinción de mayúsculas en `nombre_obra`.
 * @returns {{ success: boolean, total: number, obras: Array }}
 */
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

/**
 * POST /admin_obras/agregar
 * Crea una nueva obra, geocodificando la dirección suministrada para obtener coordenadas.
 * @body {{ nombre_obra: string, empresa_id: number, direccion: string, ciudad: string, constructora: string, activa?: boolean }}
 * @returns {{ success: boolean, obra: object }}
 * @throws {400} Si faltan campos obligatorios o la geocodificación falla.
 */
router.post("/agregar", async (req, res) => {
  try {
    const pool = global.db;
    const { nombre_obra, empresa_id, direccion, ciudad, constructora, activa } = req.body;
    console.log('[admin_obras/agregar] Datos recibidos:', req.body);
    if (!nombre_obra || !empresa_id || !direccion || !ciudad || !constructora) {
      console.error('[admin_obras/agregar] Faltan datos obligatorios:', { nombre_obra, empresa_id, direccion, ciudad, constructora });
      return res.status(400).json({ success: false, error: "Faltan datos obligatorios" });
    }
    try {
      const { geocodeColombia } = await import('../../scripts/geocode_colombia.js');
      const direccionCompleta = `${direccion}, ${ciudad}, Colombia`;
      console.log('[admin_obras/agregar] Geocodificando:', direccionCompleta);
      const { latitud, longitud } = await geocodeColombia(direccionCompleta);
      console.log('[admin_obras/agregar] Resultado geocodificación:', { latitud, longitud });
      const q = await pool.query(
        `INSERT INTO obras (nombre_obra, empresa_id, latitud, longitud, constructora, activa)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nombre_obra, empresa_id, latitud, longitud, constructora, activa`,
        [nombre_obra, empresa_id, latitud, longitud, constructora, activa !== false]
      );
      res.json({ success: true, obra: q.rows[0] });
    } catch (geoErr) {
      console.error('[admin_obras/agregar] Error geocodificación:', geoErr);
      res.status(400).json({ success: false, error: `No se pudo obtener lat/lon: ${geoErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * PATCH /admin_obras/estado/:id
 * Alterna el estado activo/inactivo de una obra.
 * @param {string} id - ID de la obra.
 * @body {{ activa: boolean }}
 * @returns {{ success: boolean, obra: { id, nombre_obra, activa } }}
 * @throws {400} Si `activa` no es booleano.
 * @throws {404} Si la obra no existe.
 */
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
