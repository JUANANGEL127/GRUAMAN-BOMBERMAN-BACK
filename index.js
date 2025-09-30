import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import formulario1Router from "./routes/gruaman/formulario1.js";
import administradorRouter from "./routes/administrador.js"; // <-- Nuevo import
import planillaBombeoRouter from "./routes/bomberman/planillabombeo.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/bomberman/planillabombeo", planillaBombeoRouter);

// Conexión a MySQL
let db;
(async () => {
  db = await mysql.createConnection({
    host: "127.0.0.1",
    user: "root",
    password: "daleolamse2004",
    database: "obra_db"
  });

  global.db = db; // <--- Asegura que global.db esté disponible para los routers

  // Crear tablas si no existen
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(50) NOT NULL UNIQUE
    );
  `);

  // Ya NO modificar la tabla obras, solo asegurar su existencia (latitud y longitud ya existen)
  await db.query(`
    CREATE TABLE IF NOT EXISTS obras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombreObra VARCHAR(100) NOT NULL UNIQUE,
      latitud DOUBLE,
      longitud DOUBLE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS trabajadores (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL UNIQUE,
      empresa_id INT,
      obra_id INT,
      numero_identificacion VARCHAR(50) UNIQUE,
      FOREIGN KEY (empresa_id) REFERENCES empresas(id),
      FOREIGN KEY (obra_id) REFERENCES obras(id)
    );
  `);
})();

// Nuevo endpoint para obtener la lista de nombres de trabajadores
app.get("/nombres-trabajadores", async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT nombre FROM trabajadores`);
    const nombres = rows.map(row => row.nombre);
    res.json({ nombres });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los nombres de trabajadores" });
  }
});

// Endpoint para recibir los datos básicos
app.post("/datos-basicos", async (req, res) => {
  const { nombre, empresa, empresa_id, obra_id, numero_identificacion } = req.body;
  // Validar parámetros obligatorios
  if (!nombre || !empresa || !empresa_id || !obra_id || !numero_identificacion) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }

  // Buscar o crear trabajador
  let [trabajador] = await db.query(
    `SELECT id, empresa_id, obra_id, numero_identificacion FROM trabajadores WHERE nombre = ?`,
    [nombre]
  );
  let trabajadorId;
  if (trabajador.length === 0) {
    const [result] = await db.query(
      `INSERT INTO trabajadores (nombre, empresa_id, obra_id, numero_identificacion) VALUES (?, ?, ?, ?)`,
      [nombre, empresa_id, obra_id, numero_identificacion]
    );
    trabajadorId = result.insertId;
  } else {
    trabajadorId = trabajador[0].id;
    // Actualizar empresa_id, obra_id y numero_identificacion si cambiaron
    if (trabajador[0].empresa_id !== empresa_id) {
      await db.query(
        `UPDATE trabajadores SET empresa_id = ? WHERE id = ?`,
        [empresa_id, trabajadorId]
      );
    }
    if (trabajador[0].obra_id !== obra_id) {
      await db.query(
        `UPDATE trabajadores SET obra_id = ? WHERE id = ?`,
        [obra_id, trabajadorId]
      );
    }
    if (trabajador[0].numero_identificacion !== numero_identificacion) {
      await db.query(
        `UPDATE trabajadores SET numero_identificacion = ? WHERE id = ?`,
        [numero_identificacion, trabajadorId]
      );
    }
  }
  res.json({
    message: "Datos básicos guardados",
    trabajadorId,
    nombre,
    empresa,
    empresa_id,
    obra_id,
    numero_identificacion
  });
});

// Endpoint para obtener el trabajadorId usando nombre, empresa, obra y numero_identificacion
app.get("/trabajador-id", async (req, res) => {
  const { nombre, empresa, obra, numero_identificacion } = req.query;
  if (!nombre || !empresa || !obra || !numero_identificacion) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }
  // Buscar empresa y obra
  let [empresaRows] = await db.query(
    `SELECT id FROM empresas WHERE nombre = ?`, [empresa]
  );
  let [obraRows] = await db.query(
    `SELECT id FROM obras WHERE nombreObra = ?`, [obra]
  );
  if (empresaRows.length === 0 || obraRows.length === 0) {
    return res.status(404).json({ error: "Empresa u obra no encontrada" });
  }
  const empresaId = empresaRows[0].id;
  const obraId = obraRows[0].id;
  // Buscar trabajador
  let [trabajador] = await db.query(
    `SELECT id, nombre, empresa_id, obra_id, numero_identificacion FROM trabajadores WHERE nombre = ? AND empresa_id = ? AND obra_id = ? AND numero_identificacion = ?`,
    [nombre, empresaId, obraId, numero_identificacion]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  // Obtener nombres de empresa y obra
  let [empresaObj] = await db.query(
    `SELECT nombre FROM empresas WHERE id = ?`, [empresaId]
  );
  let [obraObj] = await db.query(
    `SELECT nombreObra FROM obras WHERE id = ?`, [obraId]
  );
  res.json({
    trabajadorId: trabajador[0].id,
    nombre: trabajador[0].nombre,
    empresa: empresaObj[0]?.nombre || empresa,
    obra: obraObj[0]?.nombreObra || obra,
    numero_identificacion: trabajador[0].numero_identificacion
  });
});

// GET /obras: devuelve id y nombreObra de todas las obras
app.get("/obras", async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT id, nombreObra FROM obras`);
    res.json({ obras: rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener las obras" });
  }
});

// POST /validar-ubicacion: valida si la ubicación está cerca de la obra
app.post("/validar-ubicacion", async (req, res) => {
  const { obraId, lat, lon } = req.body;
  if (!obraId || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ ok: false, message: "Parámetros inválidos" });
  }
  try {
    const [rows] = await db.query(`SELECT latitud, longitud FROM obras WHERE id = ?`, [obraId]);
    if (rows.length === 0 || rows[0].latitud == null || rows[0].longitud == null) {
      return res.status(404).json({ ok: false, message: "Obra no encontrada o sin coordenadas" });
    }
    const obraLat = rows[0].latitud;
    const obraLon = rows[0].longitud;
    const distancia = getDistanceFromLatLonInMeters(lat, lon, obraLat, obraLon);
    if (distancia <= 100) {
      return res.json({ ok: true });
    } else {
      return res.status(403).json({ ok: false, message: "No estás en la ubicación de la obra seleccionada" });
    }
  } catch (error) {
    res.status(500).json({ ok: false, message: "Error al validar ubicación" });
  }
});

// Función Haversine para calcular distancia en metros
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Radio de la tierra en metros
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// Montar el router del formulario 1
app.use("/formulario1", formulario1Router);

// Montar el router de administrador
app.use("/administrador", administradorRouter);

// Aquí puedes agregar más formularios en el futuro
// app.use("/formulario2", formulario2Router);

app.listen(3000, () =>
  console.log("API corriendo en http://localhost:3000")
);

