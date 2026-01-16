import { Router } from "express";
const router = Router();

// Middleware para verificar si la base de datos está disponible
router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de checklist");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

// Obtiene los nombres de las columnas válidas y si son requeridas
async function obtenerCamposValidosYRequeridos(db, tabla) {
  const result = await db.query(
    `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = $1`,
    [tabla]
  );
  return result.rows.map(row => ({
    nombre: row.column_name,
    requerido: row.is_nullable === "NO"
  }));
}

// Guarda un nuevo checklist en la base de datos
router.post("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }
  let data = req.body;

  // Campos requeridos según la nueva estructura
  const camposRequeridos = [
    "nombre_cliente",
    "nombre_proyecto",
    "fecha_servicio",
    "nombre_operador",
    "bomba_numero",
    "horometro_motor",
    "chasis_aceite_motor",
    "chasis_funcionamiento_combustible",
    "chasis_nivel_refrigerante",
    "chasis_nivel_aceite_hidraulicos",
    "chasis_presion_llantas",
    "chasis_fugas",
    "chasis_soldadura",
    "chasis_integridad_cubierta",
    "chasis_herramientas_productos_diversos",
    "chasis_sistema_alberca",
    "chasis_filtro_hidraulico",
    "chasis_filtro_agua_limpio",
    "chasis_nivel_agua",
    "anillos",
    "anillos_desgaste",
    "placa_gafa",
    "cilindros_atornillados",
    "paso_masilla",
    "paso_agua",
    "partes_faltantes",
    "mecanismo_s",
    "funcion_sensor",
    "estado_oring",
    "funcion_vibrador",
    "paletas_eje_agitador",
    "motor_accionamiento",
    "valvula_control",
    "hidraulico_fugas",
    "hidraulico_cilindros_botellas_estado",
    "hidraulico_indicador_nivel_aceite",
    "hidraulico_enfriador_termotasto",
    "hidraulico_indicador_filtro",
    "hidraulico_limalla",
    "hidraulico_mangueras_tubos_sin_fugas",
    "superficie_nivel_deposito_grasa",
    "superficie_puntos_lubricacion",
    "superficie_empaquetaduras_conexion",
    "superficie_fugas",
    "mangueras_interna_no_deshilachadas",
    "mangueras_acoples_buen_estado",
    "mangueras_externa_no_deshilachado",
    "electrico_interruptores_buen_estado",
    "electrico_luces_funcionan",
    "electrico_cubiertas_proteccion_buenas",
    "electrico_cordon_mando_buen_estado",
    "electrico_interruptores_emergencia_funcionan",
    "electrico_conexiones_sin_oxido",
    "electrico_paros_emergencia",
    "electrico_aisladores_cables_buenos",
    "tuberia_abrazaderas_codos_ajustadas",
    "tuberia_bujia_tallo_anclados",
    "tuberia_abrazaderas_descarga_ajustadas",
    "tuberia_espesor",
    "tuberia_vertical_tallo_recta",
    "tuberia_desplazamiento_seguro",
    "equipo_limpio",
    "orden_aseo",
    "delimitacion_etiquetado",
    "permisos",
    "extintores",
    "botiquin",
    "arnes_eslinga",
    "dotacion",
    "epp",
    "rotulacion",
    "matriz_compatibilidad",
    "demarcacion_bomba",
    "orden_aseo_concreto",
    "epp_operario_auxiliar",
    "kit_mantenimiento",
    "combustible",
    "horas_motor",
    "grasa",
    "planillas"
  ];

  const faltantes = camposRequeridos.filter(
    campo => data[campo] === undefined || data[campo] === null || data[campo] === ""
  );

  if (faltantes.length > 0) {
    return res.status(400).json({
      error: "Faltan campos requeridos",
      campos_requeridos: faltantes,
      datos_recibidos: data
    });
  }

  try {
    // ...existing code for camposValidos, normalización, etc...
    const columnas = await obtenerCamposValidosYRequeridos(db, "checklist");
    const camposValidos = columnas.map(col => col.nombre);
    const optionFields = new Set(camposValidos.filter(
      k => k.endsWith("_observacion") === false &&
        k !== "id" && k !== "observaciones" &&
        k !== "nombre_cliente" && k !== "nombre_proyecto" &&
        k !== "fecha_servicio" && k !== "nombre_operador" &&
        k !== "bomba_numero" && k !== "horometro_motor"
    ));
    function normalizeOption(val) {
      if (val === undefined || val === null) return "REGULAR";
      if (typeof val === "string") {
        const s = val.trim().toUpperCase();
        if (["BUENO", "REGULAR", "MALO"].includes(s)) return s;
        if (["B", "GOOD"].includes(s)) return "BUENO";
        if (["R", "AVERAGE"].includes(s)) return "REGULAR";
        if (["M", "BAD"].includes(s)) return "MALO";
        return "REGULAR";
      }
      return "REGULAR";
    }
    camposValidos.forEach(campo => {
      if (optionFields.has(campo) && data[campo] !== undefined) {
        data[campo] = normalizeOption(data[campo]);
      }
    });
    const campos = Object.keys(data).filter(key => camposValidos.includes(key));
    const valores = campos.map(key => data[key]);
    const placeholders = campos.map((_, i) => `$${i + 1}`).join(", ");
    if (campos.length === 0) {
      return res.status(400).json({ error: "No se enviaron campos válidos para la tabla checklist" });
    }
    await db.query(
      `INSERT INTO checklist (${campos.join(", ")}) VALUES (${placeholders})`,
      valores
    );

    // --- Generar PDF y enviar por correo ---
    // Reutiliza la función de checklist_admin.js para generar el PDF llenando checklist_admin_template.xlsx
    try {
      const nodemailer = await import('nodemailer');
      const adminModule = await import(process.cwd() + '/routes/administrador_bomberman/checklist_admin.js');
      const generarPDFPorChecklist = adminModule.generarPDFPorChecklist || (adminModule.default && adminModule.default.generarPDFPorChecklist);
      if (typeof generarPDFPorChecklist !== 'function') throw new Error('No se pudo importar la función generarPDFPorChecklist');
      // Filtra solo campos REGULAR o MALO y sus observaciones
      const camposValidos = Object.keys(data);
      const respuestasRegMal = {};
      camposValidos.forEach(campo => {
        if (typeof data[campo] === 'string' && (data[campo].toUpperCase() === 'REGULAR' || data[campo].toUpperCase() === 'MALO')) {
          respuestasRegMal[campo] = data[campo];
          // Busca observación asociada si existe
          const obsKey = campo + '_observacion';
          if (data[obsKey]) {
            respuestasRegMal[obsKey] = data[obsKey];
          }
        }
      });
      // Genera el PDF solo con estos campos
      const pdfBuf = await generarPDFPorChecklist(respuestasRegMal);
      // Configura nodemailer con variables de entorno
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 465,
        secure: true,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: 'scliente@allinconcrete.com.co, administracion@allinconcrete.com.co, comercial.operativa@allinconcrete.com.co, dir.operativabta@allinconcrete.com.co',
        subject: 'Nuevo checklist registrado',
        text: 'Se ha registrado un nuevo checklist. Adjuntamos el PDF generado automáticamente.',
        attachments: [{ filename: 'checklist.pdf', content: pdfBuf }]
      });
    } catch (mailErr) {
      console.error('Error generando PDF o enviando correo:', mailErr);
    }

    res.json({ message: "Checklist guardado correctamente y PDF enviado por correo" });
  } catch (error) {
    console.error("Error al guardar checklist:", error);
    res.status(500).json({ error: "Error al guardar checklist", detalle: error.message });
  }
});

// Obtiene todos los registros de la tabla checklist
router.get("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    return res.status(500).json({ error: "DB no disponible" });
  }
  try {
    // Trae todos los datos y columnas de la tabla checklist
    const result = await db.query(`SELECT * FROM checklist ORDER BY id DESC`);
    res.json({ registros: result.rows });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros", detalle: error.message });
  }
});

export default router;
