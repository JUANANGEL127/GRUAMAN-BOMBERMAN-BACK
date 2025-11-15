import { Router } from "express";
import moment from "moment-timezone";

const router = Router();

// Guarda un registro de horas para un trabajador
router.post("/registros", async (req, res) => {
  const { trabajador_id, hora_usuario, tipo } = req.body;

  if (!trabajador_id || !hora_usuario || !tipo) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios" });
  }

  let [trabajador] = await db.query(
    `SELECT id FROM trabajadores WHERE id = ?`,
    [trabajador_id]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }

  const fecha = moment().tz("America/Bogota").format("YYYY-MM-DD");

  await db.query(
    `INSERT INTO registros_horas (trabajador_id, fecha, hora_usuario, tipo)
     VALUES (?, ?, ?, ?)`,
    [trabajador_id, fecha, hora_usuario, tipo]
  );

  res.json({
    message: "Registro guardado",
    trabajador_id,
    hora_usuario,
    tipo
  });
});

// Calcula las horas trabajadas (usuario y sistema) por nombre y fecha
router.get("/horas/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.nombre, t.numero_identificacion, e.nombre as empresa, o.nombre_obra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajador_id = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
    [trabajador_id, fecha]
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

  const horas_usuario_final = Math.max((totalMinutosUsuario / 60) - 1, 0).toFixed(2);
  const horas_sistema_final = Math.max((totalMinutosSistema / 60) - 1, 0).toFixed(2);

  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    numero_identificacion,
    horas_usuario: horas_usuario_final,
    horas_sistema: horas_sistema_final
  });
});

// Obtiene todos los registros de un trabajador por nombre y fecha
router.get("/registros/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajador_id = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT * FROM registros_horas WHERE trabajador_id = ? AND fecha = ?`,
    [trabajador_id, fecha]
  );
  res.json({
    empresa,
    numero_identificacion,
    registros: rows
  });
});

// Obtiene las horas ingresadas por el usuario para un trabajador
router.get("/horas-usuario/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa, o.nombre_obra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajador_id = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_usuario`,
    [trabajador_id, fecha]
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

// Obtiene las horas registradas por la aplicación para un trabajador
router.get("/horas-sistema/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa, o.nombre_obra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajador_id = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
    [trabajador_id, fecha]
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

// Calcula las horas extras trabajadas por un trabajador
router.get("/horas-extras/:nombre/:fecha", async (req, res) => {
  const { nombre, fecha } = req.params;
  let [trabajador] = await db.query(
    `SELECT t.id, t.numero_identificacion, e.nombre as empresa, o.nombre_obra as obra FROM trabajadores t LEFT JOIN empresas e ON t.empresa_id = e.id LEFT JOIN obras o ON t.obra_id = o.id WHERE t.nombre = ?`,
    [nombre]
  );
  if (trabajador.length === 0) {
    return res.status(404).json({ error: "Trabajador no encontrado" });
  }
  const trabajador_id = trabajador[0].id;
  const empresa = trabajador[0].empresa;
  const obra = trabajador[0].obra;
  const numero_identificacion = trabajador[0].numero_identificacion;
  const [rows] = await db.query(
    `SELECT tipo, hora_usuario, hora_sistema FROM registros_horas WHERE trabajador_id = ? AND fecha = ? ORDER BY hora_sistema`,
    [trabajador_id, fecha]
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

  const horas_usuario_final = Math.max((totalMinutosUsuario / 60) - 1, 0);
  const horas_sistema_final = Math.max((totalMinutosSistema / 60) - 1, 0);
  const horas_extras_usuario = Math.max(horas_usuario_final - 8, 0).toFixed(2);
  const horas_extras_sistema = Math.max(horas_sistema_final - 8, 0).toFixed(2);

  res.json({
    fecha,
    nombre,
    empresa,
    obra,
    numero_identificacion,
    horas_extras_usuario,
    horas_extras_sistema
  });
});

// Obtiene un resumen de todos los registros de horas
router.get("/registros-todos-resumen", async (req, res) => {
  const [trabajadores] = await db.query(
    `SELECT t.id, t.nombre, t.numero_identificacion, e.nombre as empresa, o.nombre_obra as obra FROM trabajadores t
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

      const horas_usuario_final = Math.max((totalMinutosUsuario / 60) - 1, 0);
      const horas_sistema_final = Math.max((totalMinutosSistema / 60) - 1, 0);
      const horas_extras_usuario = Math.max(horas_usuario_final - 9, 0).toFixed(2);
      const horas_extras_sistema = Math.max(horas_sistema_final - 9, 0).toFixed(2);

      resumen.push({
        nombre: trabajador.nombre,
        empresa: trabajador.empresa,
        obra: trabajador.obra,
        numero_identificacion: trabajador.numero_identificacion,
        fecha,
        horas_usuario: horas_usuario_final.toFixed(2),
        horas_sistema: horas_sistema_final.toFixed(2),
        horas_extras_usuario,
        horas_extras_sistema
      });
    }
  }
  res.json(resumen);
});

export default router;
