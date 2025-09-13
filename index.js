import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import formulario1Router from "./routes/formulario1.js";

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MySQL
let db;
(async () => {
  db = await mysql.createConnection({
    host: "127.0.0.1",
    user: "root",
    password: "daleolamse2004",
    database: "obra_db"
  });

  // Crear tablas si no existen
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(50) NOT NULL UNIQUE
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS obras (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre VARCHAR(100) NOT NULL UNIQUE
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

// Endpoint para recibir los datos básicos
app.post("/datos-basicos", async (req, res) => {
  const { nombre, empresa, obra, numero_identificacion } = req.body;
  if (!nombre || !empresa || !obra || !numero_identificacion) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }
  // Buscar o crear empresa
  let [empresaRows] = await db.query(
    `SELECT id FROM empresas WHERE nombre = ?`,
    [empresa]
  );
  let empresaId;
  if (empresaRows.length === 0) {
    const [result] = await db.query(
      `INSERT INTO empresas (nombre) VALUES (?)`,
      [empresa]
    );
    empresaId = result.insertId;
  } else {
    empresaId = empresaRows[0].id;
  }
  // Buscar o crear obra
  let [obraRows] = await db.query(
    `SELECT id FROM obras WHERE nombre = ?`,
    [obra]
  );
  let obraId;
  if (obraRows.length === 0) {
    const [result] = await db.query(
      `INSERT INTO obras (nombre) VALUES (?)`,
      [obra]
    );
    obraId = result.insertId;
  } else {
    obraId = obraRows[0].id;
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
      [nombre, empresaId, obraId, numero_identificacion]
    );
    trabajadorId = result.insertId;
  } else {
    trabajadorId = trabajador[0].id;
    // Actualizar empresa_id y numero_identificacion solo si cambió
    if (trabajador[0].empresa_id !== empresaId) {
      await db.query(
        `UPDATE trabajadores SET empresa_id = ? WHERE id = ?`,
        [empresaId, trabajadorId]
      );
    }
    if (trabajador[0].numero_identificacion !== numero_identificacion) {
      await db.query(
        `UPDATE trabajadores SET numero_identificacion = ? WHERE id = ?`,
        [numero_identificacion, trabajadorId]
      );
    }
    // No modificar obra_id si el trabajador ya existe
  }
  res.json({
    message: "Datos básicos guardados",
    trabajadorId,
    nombre,
    empresa,
    obra,
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
    `SELECT id FROM obras WHERE nombre = ?`, [obra]
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
    `SELECT nombre FROM obras WHERE id = ?`, [obraId]
  );
  res.json({
    trabajadorId: trabajador[0].id,
    nombre: trabajador[0].nombre,
    empresa: empresaObj[0]?.nombre || empresa,
    obra: obraObj[0]?.nombre || obra,
    numero_identificacion: trabajador[0].numero_identificacion
  });
});

// Montar el router del formulario 1
app.use("/formulario1", formulario1Router);

// Aquí puedes agregar más formularios en el futuro
// app.use("/formulario2", formulario2Router);

app.listen(3000, () =>
  console.log("API corriendo en http://localhost:3000")
);

