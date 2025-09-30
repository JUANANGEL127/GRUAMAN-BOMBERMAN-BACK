import { Router } from "express";
import mysql from "mysql2/promise";
import moment from "moment-timezone";

const router = Router();

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
})();

// POST: procesar solo los datos del formulario1
router.post("/registros", async (req, res) => {
  const { trabajadorId, hora_usuario, tipo } = req.body;

  if (!trabajadorId || !hora_usuario || !tipo) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }

  // Buscar trabajador
  let [trabajador] = await db.query(
    `SELECT id FROM trabajadores WHERE id = ?`,
    [trabajadorId]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
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
    hora_usuario,
    tipo
  });
});

// GET: calcular horas trabajadas (usuario y sistema) por nombre
router.get("/horas/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.nombre, t.numero_identificacion, e.nombre as empresa, o.nombreObra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
    [trabajadorId, fecha]
  );
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
  const horasUsuarioFinal = Math.max((totalMinutosUsuario / 60) - 1, 0).toFixed(2);
  const horasSistemaFinal = Math.max((totalMinutosSistema / 60) - 1, 0).toFixed(2);
  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    numero_identificacion,
    horas_usuario: horasUsuarioFinal,
    horas_sistema: horasSistemaFinal
  });
});

// GET: ver todos los registros de un trabajador por nombre (incluye empresa)
router.get("/registros/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT * FROM registros_horas WHERE trabajador_id = ? AND fecha = ?`,
    [trabajadorId, fecha]
  );
  res.json({
    empresa,
    numero_identificacion,
    registros: rows
  });
});

// GET: horas que ingresó el usuario por nombre
router.get("/horas-usuario/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa, o.nombreObra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_usuario`,
    [trabajadorId, fecha]
  );
  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    numero_identificacion,
    horas_usuario: rows
  });
});

// GET: horas registradas por la app (hora_sistema con timezone Colombia) por nombre
router.get("/horas-sistema/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa, o.nombreObra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
    [trabajadorId, fecha]
  );
  const horas_sistema = rows.map(r => ({
    tipo: r.tipo,
    hora_sistema: moment(r.hora_sistema).tz("America/Bogota").format("HH:mm:ss")
  }));
  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    numero_identificacion,
    horas_sistema
  });
});

// GET: horas extras trabajadas por nombre
router.get("/horas-extras/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa, o.nombreObra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajadorId = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
    [trabajadorId, fecha]
  );
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
  const horasUsuarioFinal = Math.max((totalMinutosUsuario / 60) - 1, 0);
  const horasSistemaFinal = Math.max((totalMinutosSistema / 60) - 1, 0);
  const horasExtrasUsuario = Math.max(horasUsuarioFinal - 8, 0).toFixed(2);
  const horasExtrasSistema = Math.max(horasSistemaFinal - 8, 0).toFixed(2);
  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    numero_identificacion,
    horas_extras_usuario: horasExtrasUsuario,
    horas_extras_sistema: horasExtrasSistema
  });
});

// GET: resumen de todos los registros
router.get("/registros-todos-resumen", async (req, res) => {
  const [trabajadores] = await db.query(
    `SELECT t.id, t.nombre, t.numero_identificacion, e.nombre as empresa, o.nombreObra as obra FROM trabajadores t
     LEFT JOIN empresas e ON t.empresa_id = e.id
     LEFT JOIN obras o ON t.obra_id = o.id`
  );
  const resumen = [];
  for (const trabajador of trabajadores) {
    const [fechas] = await db.query(
      `SELECT DISTINCT fecha FROM registros_horas WHERE trabajador_id = ? ORDER BY fecha`,
      [trabajador.id]
    );
    for (const f of fechas) {
      const fecha = f.fecha;
      const [registros] = await db.query(
        `SELECT tipo, hora_usuario, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
        [trabajador.id, fecha]
      );
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
      const horasUsuarioFinal = Math.max((totalMinutosUsuario / 60) - 1, 0);
      const horasSistemaFinal = Math.max((totalMinutosSistema / 60) - 1, 0);
      const horasExtrasUsuario = Math.max(horasUsuarioFinal - 9, 0).toFixed(2);
      const horasExtrasSistema = Math.max(horasSistemaFinal - 9, 0).toFixed(2);
      resumen.push({
        nombre: trabajador.nombre,
        empresa: trabajador.empresa,
        obra: trabajador.obra,
        numero_identificacion: trabajador.numero_identificacion,
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

export default router;
