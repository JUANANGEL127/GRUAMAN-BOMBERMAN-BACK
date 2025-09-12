import express from "express";
import mysql from "mysql2/promise";
import moment from "moment-timezone";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MySQL
const db = await mysql.createConnection({
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
    FOREIGN KEY (empresa_id) REFERENCES empresas(id),
    FOREIGN KEY (obra_id) REFERENCES obras(id)
  );
`);

await db.query(`
  CREATE TABLE IF NOT EXISTS registros_horas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    trabajador_id INT NOT NULL,
    fecha DATE NOT NULL,
    hora_usuario TIME NOT NULL,
    hora_sistema TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tipo ENUM('entrada','salida') NOT NULL,
    FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id)
  );
`);

// 🔹 POST: guardar entrada/salida con nombre y empresa
app.post("/registros", async (req, res) => {
  const { nombre, hora_usuario, tipo, empresa, obra } = req.body;

  if (!nombre || !hora_usuario || !tipo || !empresa || !obra) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }

  // Buscar empresa por nombre (NO crear nuevas empresas)
  let [empresaRows] = await db.query(
    `SELECT id FROM empresas WHERE nombre = ?`,
    [empresa]
  );
  if (empresaRows.length === 0) {
    return res.status(400).json({ error: "Empresa no válida" });
  }
  const empresaId = empresaRows[0].id;

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
    `SELECT id, empresa_id, obra_id FROM trabajadores WHERE nombre = ?`,
    [nombre]
  );

  let trabajadorId;
  if (trabajador.length === 0) {
    const [result] = await db.query(
      `INSERT INTO trabajadores (nombre, empresa_id, obra_id) VALUES (?, ?, ?)`,
      [nombre, empresaId, obraId]
    );
    trabajadorId = result.insertId;
  } else {
    trabajadorId = trabajador[0].id;
    // Actualizar empresa_id solo si cambió
    if (trabajador[0].empresa_id !== empresaId) {
      await db.query(
        `UPDATE trabajadores SET empresa_id = ? WHERE id = ?`,
        [empresaId, trabajadorId]
      );
    }
    // No modificar obra_id si el trabajador ya existe
  }

  const fecha = moment().tz("America/Bogota").format("YYYY-MM-DD");

  await db.query(
    `INSERT INTO registros_horas (trabajador_id, fecha, hora_usuario, tipo)
     VALUES (?, ?, ?, ?)`,
    [trabajadorId, fecha, hora_usuario, tipo]
  );

  res.json({
    message: "Registro guardado",
    trabajadorId,
    nombre,
    empresa,
    obra,
    hora_usuario
  });
});

// 🔹 GET: calcular horas trabajadas (usuario y sistema) por nombre
app.get("/horas/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;

  // Buscar trabajador por nombre, empresa y obra
  let [trabajador] = await db.query(
    `SELECT t.id, e.nombre as empresa, o.nombre as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );

  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;

  // Consultar registros (usuario y sistema)
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario, hora_sistema 
     FROM registros_horas 
     WHERE trabajador_id = ? AND fecha = ?
     ORDER BY hora_sistema`,
    [trabajadorId, fecha]
  );

  // ---- Calcular horas trabajadas (hora_usuario)
  let totalMinutosUsuario = 0;
  let entradaUsuario = null;

  rows.forEach(r => {
    const horaUsuario = moment(r.hora_usuario, "HH:mm:ss");
    if (r.tipo === "entrada") {
      entradaUsuario = horaUsuario;
    } else if (r.tipo === "salida" && entradaUsuario) {
      totalMinutosUsuario += horaUsuario.diff(entradaUsuario, "minutes");
      entradaUsuario = null;
    }
  });

  // ---- Calcular horas trabajadas (hora_sistema)
  let totalMinutosSistema = 0;
  let entradaSistema = null;

  rows.forEach(r => {
    const horaSistema = moment(r.hora_sistema).tz("America/Bogota");
    if (r.tipo === "entrada") {
      entradaSistema = horaSistema;
    } else if (r.tipo === "salida" && entradaSistema) {
      totalMinutosSistema += horaSistema.diff(entradaSistema, "minutes");
      entradaSistema = null;
    }
  });

  // Restar 1 hora al total final
  const horasUsuarioFinal = Math.max((totalMinutosUsuario / 60) - 1, 0).toFixed(2);
  const horasSistemaFinal = Math.max((totalMinutosSistema / 60) - 1, 0).toFixed(2);

  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    horas_usuario: horasUsuarioFinal,
    horas_sistema: horasSistemaFinal
  });
});

// 🔹 GET: ver todos los registros de un trabajador por nombre (incluye empresa)
app.get("/registros/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;

  let [trabajador] = await db.query(
    `SELECT t.id, e.nombre as empresa FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id WHERE t.nombre = ?`,
    [nombre]
  );

  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }

  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;

  const [rows] = await db.query(
    `SELECT * FROM registros_horas WHERE trabajador_id = ? AND fecha = ?`,
    [trabajadorId, fecha]
  );

  res.json({
    empresa,
    registros: rows
  });
});

// 🔹 GET: horas que ingresó el usuario por nombre
app.get("/horas-usuario/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;

  let [trabajador] = await db.query(
    `SELECT t.id, e.nombre as empresa, o.nombre as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );

  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }

  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;

  const [rows] = await db.query(
    `SELECT tipo, hora_usuario 
     FROM registros_horas 
     WHERE trabajador_id = ? AND fecha = ? 
     ORDER BY hora_usuario`,
    [trabajadorId, fecha]
  );

  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    horas_usuario: rows
  });
});

// 🔹 GET: horas registradas por la app (hora_sistema con timezone Colombia) por nombre
app.get("/horas-sistema/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;

  let [trabajador] = await db.query(
    `SELECT t.id, e.nombre as empresa, o.nombre as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );

  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }

  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;

  const [rows] = await db.query(
    `SELECT tipo, hora_sistema 
     FROM registros_horas 
     WHERE trabajador_id = ? AND fecha = ? 
     ORDER BY hora_sistema`,
    [trabajadorId, fecha]
  );

  // Convertir hora_sistema a zona horaria de Colombia antes de responder
  const horas_sistema = rows.map(r => ({
    tipo: r.tipo,
    hora_sistema: moment(r.hora_sistema).tz("America/Bogota").format("HH:mm:ss")
  }));

  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    horas_sistema
  });
});

// 🔹 GET: horas extras trabajadas por nombre
app.get("/horas-extras/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;

  let [trabajador] = await db.query(
    `SELECT t.id, e.nombre as empresa, o.nombre as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );

  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;

  // Consultar registros (usuario y sistema)
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario, hora_sistema 
     FROM registros_horas 
     WHERE trabajador_id = ? AND fecha = ?
     ORDER BY hora_sistema`,
    [trabajadorId, fecha]
  );

  // ---- Calcular horas trabajadas (hora_usuario)
  let totalMinutosUsuario = 0;
  let entradaUsuario = null;

  rows.forEach(r => {
    const horaUsuario = moment(r.hora_usuario, "HH:mm:ss");
    if (r.tipo === "entrada") {
      entradaUsuario = horaUsuario;
    } else if (r.tipo === "salida" && entradaUsuario) {
      totalMinutosUsuario += horaUsuario.diff(entradaUsuario, "minutes");
      entradaUsuario = null;
    }
  });

  // ---- Calcular horas trabajadas (hora_sistema)
  let totalMinutosSistema = 0;
  let entradaSistema = null;

  rows.forEach(r => {
    const horaSistema = moment(r.hora_sistema).tz("America/Bogota");
    if (r.tipo === "entrada") {
      entradaSistema = horaSistema;
    } else if (r.tipo === "salida" && entradaSistema) {
      totalMinutosSistema += horaSistema.diff(entradaSistema, "minutes");
      entradaSistema = null;
    }
  });

  // Restar 1 hora al total final
  const horasUsuarioFinal = Math.max((totalMinutosUsuario / 60) - 1, 0);
  const horasSistemaFinal = Math.max((totalMinutosSistema / 60) - 1, 0);

  // Calcular horas extras (restar 9 horas, no mostrar negativos)
  const horasExtrasUsuario = Math.max(horasUsuarioFinal - 8, 0).toFixed(2);
  const horasExtrasSistema = Math.max(horasSistemaFinal - 8, 0).toFixed(2);

  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    horas_extras_usuario: horasExtrasUsuario,
    horas_extras_sistema: horasExtrasSistema
  });
});

// 🔹 GET: resumen de todos los registros
app.get("/registros-todos-resumen", async (req, res) => {
  // Obtener todos los trabajadores con empresa y obra
  const [trabajadores] = await db.query(
    `SELECT t.id, t.nombre, e.nombre as empresa, o.nombre as obra FROM trabajadores t
     LEFT JOIN empresas e ON t.empresa_id = e.id
     LEFT JOIN obras o ON t.obra_id = o.id`
  );

  const resumen = [];

  for (const trabajador of trabajadores) {
    // Obtener todas las fechas con registros para este trabajador
    const [fechas] = await db.query(
      `SELECT DISTINCT fecha FROM registros_horas WHERE trabajador_id = ? ORDER BY fecha`,
      [trabajador.id]
    );

    for (const f of fechas) {
      const fecha = f.fecha;
      // Obtener todos los registros de este trabajador en esa fecha
      const [registros] = await db.query(
        `SELECT tipo, hora_usuario, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
        [trabajador.id, fecha]
      );

      // Calcular horas trabajadas usuario
      let totalMinutosUsuario = 0;
      let entradaUsuario = null;
      registros.forEach(r => {
        const horaUsuario = moment(r.hora_usuario, "HH:mm:ss");
        if (r.tipo === "entrada") {
          entradaUsuario = horaUsuario;
        } else if (r.tipo === "salida" && entradaUsuario) {
          totalMinutosUsuario += horaUsuario.diff(entradaUsuario, "minutes");
          entradaUsuario = null;
        }
      });

      // Calcular horas trabajadas sistema
      let totalMinutosSistema = 0;
      let entradaSistema = null;
      registros.forEach(r => {
        const horaSistema = moment(r.hora_sistema).tz("America/Bogota");
        if (r.tipo === "entrada") {
          entradaSistema = horaSistema;
        } else if (r.tipo === "salida" && entradaSistema) {
          totalMinutosSistema += horaSistema.diff(entradaSistema, "minutes");
          entradaSistema = null;
        }
      });

      // Restar 1 hora al total final
      const horasUsuarioFinal = Math.max((totalMinutosUsuario / 60) - 1, 0);
      const horasSistemaFinal = Math.max((totalMinutosSistema / 60) - 1, 0);

      // Calcular horas extras (restar 9 horas, no mostrar negativos)
      const horasExtrasUsuario = Math.max(horasUsuarioFinal - 9, 0).toFixed(2);
      const horasExtrasSistema = Math.max(horasSistemaFinal - 9, 0).toFixed(2);

      resumen.push({
        nombre: trabajador.nombre,
        empresa: trabajador.empresa,
        obra: trabajador.obra,
        fecha,
        horas_usuario: horasUsuarioFinal.toFixed(2),
        horas_sistema: horasSistemaFinal.toFixed(2),
        horas_extras_usuario: horasExtrasUsuario,
        horas_extras_sistema: horasExtrasSistema
      });
    }
  }

  res.json(resumen);
});

app.listen(3000, () =>
  console.log("API corriendo en http://localhost:3000")
);

