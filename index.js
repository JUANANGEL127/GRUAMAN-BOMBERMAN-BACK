import express from "express";
import cors from "cors";
import pkg from "pg";
import formulario1Router from "./routes/gruaman/formulario1.js";
import administradorRouter from "./routes/administrador.js";
import planillaBombeoRouter from "./routes/bomberman/planillabombeo.js";

const { Pool } = pkg;
const app = express();

app.use(cors());
app.use(express.json());
app.use("/bomberman/planillabombeo", planillaBombeoRouter);

// Conexión a PostgreSQL
const pool = new Pool({
  host: "localhost",
  user: "postgres",
  password: "", // cambia si tu contraseña es diferente
  database: "postgres", // tu base creada en pgAdmin
  port: 5432,
});

global.db = pool;

// Crear tablas si no existen
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresas (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(50) UNIQUE NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS obras (
      id SERIAL PRIMARY KEY,
      nombreObra VARCHAR(150) UNIQUE NOT NULL,
      latitud DECIMAL(10,6) NOT NULL,
      longitud DECIMAL(10,6) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS trabajadores (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(100) UNIQUE NOT NULL,
      empresa_id INT REFERENCES empresas(id),
      obra_id INT REFERENCES obras(id),
      numero_identificacion VARCHAR(50) UNIQUE,
      empresa VARCHAR(50) NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS registros_horas (
      id SERIAL PRIMARY KEY,
      trabajador_id INT NOT NULL REFERENCES trabajadores(id) ON DELETE CASCADE,
      fecha DATE NOT NULL,
      turno TEXT CHECK (turno IN ('mañana', 'tarde')) NOT NULL,
      hora_usuario TIME NOT NULL,
      hora_sistema TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      tipo TEXT CHECK (tipo IN ('entrada', 'salida')) NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS planillaBombeo (
      id SERIAL PRIMARY KEY,
      nombre_cliente VARCHAR(100) NOT NULL,
      nombre_proyecto VARCHAR(150) NOT NULL,
      fecha_servicio DATE NOT NULL,
      bomba_numero VARCHAR(20) NOT NULL,
      hora_llegada_obra TIME NOT NULL,
      hora_salida_obra TIME NOT NULL,
      hora_inicio_acpm TIME NOT NULL,
      hora_final_acpm TIME NOT NULL,
      horometro_inicial DECIMAL(10,2) NOT NULL,
      horometro_final DECIMAL(10,2) NOT NULL,
      nombre_operador VARCHAR(100) NOT NULL,
      nombre_auxiliar VARCHAR(100),
      total_metros_cubicos_bombeados DECIMAL(10,2) NOT NULL
    );
  `);
})();

// 🔹 Endpoint: obtener nombres de trabajadores
app.get("/nombres-trabajadores", async (req, res) => {
  try {
    const result = await pool.query(`SELECT nombre FROM trabajadores`);
    const nombres = result.rows.map(row => row.nombre);
    res.json({ nombres });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener los nombres de trabajadores" });
  }
});

// 🔹 Endpoint: guardar datos básicos
app.post("/datos-basicos", async (req, res) => {
  const { nombre, empresa, empresa_id, obra_id, numero_identificacion } = req.body;

  if (!nombre) return res.status(400).json({ error: "Falta parámetro: nombre" });
  if (!empresa) return res.status(400).json({ error: "Falta parámetro: empresa" });
  if (!empresa_id) return res.status(400).json({ error: "Falta parámetro: empresa_id" });
  if (!obra_id) return res.status(400).json({ error: "Falta parámetro: obra_id" });
  if (!numero_identificacion) return res.status(400).json({ error: "Falta parámetro: numero_identificacion" });

  try {
    const trabajador = await pool.query(
      `SELECT id, empresa_id, obra_id, numero_identificacion FROM trabajadores WHERE nombre = $1`,
      [nombre]
    );
    let trabajadorId;
    if (trabajador.rows.length === 0) {
      const result = await pool.query(
        `INSERT INTO trabajadores (nombre, empresa_id, obra_id, numero_identificacion, empresa)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [nombre, empresa_id, obra_id, numero_identificacion, empresa]
      );
      trabajadorId = result.rows[0].id;
    } else {
      trabajadorId = trabajador.rows[0].id;
      if (trabajador.rows[0].empresa_id !== empresa_id)
        await pool.query(`UPDATE trabajadores SET empresa_id = $1 WHERE id = $2`, [empresa_id, trabajadorId]);
      if (trabajador.rows[0].obra_id !== obra_id)
        await pool.query(`UPDATE trabajadores SET obra_id = $1 WHERE id = $2`, [obra_id, trabajadorId]);
      if (trabajador.rows[0].numero_identificacion !== numero_identificacion)
        await pool.query(`UPDATE trabajadores SET numero_identificacion = $1 WHERE id = $2`, [numero_identificacion, trabajadorId]);
      if (trabajador.rows[0].empresa !== empresa)
        await pool.query(`UPDATE trabajadores SET empresa = $1 WHERE id = $2`, [empresa, trabajadorId]);
    }

    res.json({
      message: "Datos básicos guardados",
      trabajadorId,
      nombre,
      empresa,
      empresa_id,
      obra_id,
      numero_identificacion,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al guardar los datos" });
  }
});

// 🔹 Endpoint: obtener trabajadorId
app.get("/trabajador-id", async (req, res) => {
  const { nombre, empresa, obra, numero_identificacion } = req.query;
  if (!nombre || !empresa || !obra || !numero_identificacion) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }
  try {
    const empresaRows = await pool.query(`SELECT id FROM empresas WHERE nombre = $1`, [empresa]);
    const obraRows = await pool.query(`SELECT id FROM obras WHERE nombreObra = $1`, [obra]);

    if (empresaRows.rows.length === 0 || obraRows.rows.length === 0)
      return res.status(404).json({ error: "Empresa u obra no encontrada" });

    const empresa_id = empresaRows.rows[0].id;
    const obra_id = obraRows.rows[0].id;

    const trabajador = await pool.query(
      `SELECT id, nombre, empresa_id, obra_id, numero_identificacion, empresa
       FROM trabajadores WHERE nombre = $1 AND empresa_id = $2 AND obra_id = $3 AND numero_identificacion = $4`,
      [nombre, empresa_id, obra_id, numero_identificacion]
    );

    if (trabajador.rows.length === 0)
      return res.status(404).json({ error: "Trabajador no encontrado" });

    const empresaObj = await pool.query(`SELECT nombre FROM empresas WHERE id = $1`, [empresa_id]);
    const obraObj = await pool.query(`SELECT nombreObra FROM obras WHERE id = $1`, [obra_id]);

    res.json({
      trabajadorId: trabajador.rows[0].id,
      nombre: trabajador.rows[0].nombre,
      empresa: empresaObj.rows[0]?.nombre || empresa,
      obra: obraObj.rows[0]?.nombreObra || obra,
      numero_identificacion: trabajador.rows[0].numero_identificacion,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener trabajador" });
  }
});

// 🔹 Endpoint: obtener obras
app.get("/obras", async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, nombreObra FROM obras`);
    res.json({ obras: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al obtener las obras" });
  }
});

// 🔹 Validar ubicación (misma lógica)
app.post("/validar-ubicacion", async (req, res) => {
  const { obra_id, lat, lon } = req.body;
  if (!obra_id || typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ ok: false, message: "Parámetros inválidos" });
  }
  try {
    const result = await pool.query(`SELECT latitud, longitud FROM obras WHERE id = $1`, [obra_id]);
    if (result.rows.length === 0 || result.rows[0].latitud == null || result.rows[0].longitud == null) {
      return res.status(404).json({ ok: false, message: "Obra no encontrada o sin coordenadas" });
    }
    const { latitud, longitud } = result.rows[0];
    const distancia = getDistanceFromLatLonInMeters(lat, lon, latitud, longitud);
    if (distancia <= 100) {
      res.json({ ok: true });
    } else {
      res.status(403).json({ ok: false, message: "No estás en la ubicación de la obra seleccionada" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, message: "Error al validar ubicación" });
  }
});

// 🔹 Función Haversine
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// 🔹 Montar routers
app.use("/formulario1", formulario1Router);
app.use("/administrador", administradorRouter);

app.listen(3000, () =>
  console.log("✅ API corriendo en http://localhost:3000 (PostgreSQL conectado)")
);
