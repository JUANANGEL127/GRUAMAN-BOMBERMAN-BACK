import { Router } from "express";
import { enviarDocumentoAFirmar, POSICIONES_FIRMA } from '../signio.js';
import { generarPDF, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';
import { formatDateOnly } from '../../helpers/dateUtils.js';
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

  // Solo se validan los campos de cabecera comunes a todos los cargos.
  // Los campos de inspección varían según el cargo (operario/auxiliar): el
  // frontend envía únicamente los campos del cargo activo, por lo que
  // validar campos de ambos cargos aquí rechazaría siempre con 400.
  const camposRequeridos = [
    "nombre_cliente",
    "nombre_proyecto",
    "fecha_servicio",
    "nombre_operador",
    "bomba_numero",
    "horometro_motor"
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
    const columnas = await obtenerCamposValidosYRequeridos(db, "checklist");
    const camposValidos = columnas.map(col => col.nombre);
    // Campos que NO se normalizan (numéricos, fechas, texto libre)
    const noNormalizar = new Set([
      "radio_marca_serial_estado", "arnes_marca_serial_fecha_estado", "eslinga_marca_serial_fecha_estado",
      "combustible_pimpinas", "ultima_fecha_lavado_tanque", "dias_grasa", "punto_engrase_tapado",
      "ultima_fecha_mantenimiento_salida", "mangueras_3_pulgadas", "mangueras_4_pulgadas", "mangueras_5_pulgadas",
      "mangueras_sin_acoples", "numero_piso_fundiendo", "cantidad_puntos_anclaje", "ultima_fecha_medicion_espesores"
    ]);
    const optionFields = new Set(camposValidos.filter(
      k => k.endsWith("_observacion") === false &&
        !k.endsWith("_galones") &&
        !noNormalizar.has(k) &&
        k !== "id" && k !== "observaciones" && k !== "empresa_id" &&
        k !== "nombre_cliente" && k !== "nombre_proyecto" &&
        k !== "fecha_servicio" && k !== "nombre_operador" &&
        k !== "bomba_numero" && k !== "horometro_motor"
    ));
    // Normaliza valores según opciones del formulario (Bueno/Malo, SI/NO, Limpio, etc.)
    function normalizeOption(val, campo) {
      if (val === undefined || val === null) return "REGULAR";
      if (typeof val === "string") {
        const s = val.trim().toUpperCase().replace(/\s+/g, "_");
        const estandar = ["BUENO", "REGULAR", "MALO"];
        if (estandar.includes(s)) return s;
        if (["B", "GOOD"].includes(s)) return "BUENO";
        if (["R", "AVERAGE"].includes(s)) return "REGULAR";
        if (["M", "BAD"].includes(s)) return "MALO";
        // chasis_aceite_motor, aceite_hidrolavadora: Bueno - Emulsionado
        if (s === "EMULSIONADO") return "EMULSIONADO";
        // chasis_nivel_refrigerante: Bajo - Normal
        if (["BAJO", "NORMAL"].includes(s)) return s;
        // sensor_motor_aspas, mecanismo_tubo_s, vertical_tallo_recta: SI - NO
        if (["SI", "NO"].includes(s)) return s;
        // filtro_primario_combustible: Limpio - No limpio
        if (s === "LIMPIO") return "LIMPIO";
        if (["NO_LIMPIO", "NOLIMPIO", "NO LIMPIO"].includes(s)) return "NO LIMPIO";
        // drenaje_filtro_combustible: Realizado - No realizado
        if (s === "REALIZADO") return "Realizado";
        if (["NO_REALIZADO", "NOREALIZADO", "NO REALIZADO"].includes(s)) return "No realizado";
        // partes_faltantes_nuevo: Si faltan - No faltan
        if (["SI_FALTAN", "FALTAN"].includes(s)) return "Si faltan";
        if (["NO_FALTAN", "NOFALTAN"].includes(s)) return "No faltan";
        // caja_agua_condiciones: Cumple - No cumple
        if (["CUMPLE", "CUMPLE_CON_CONDICIONES"].includes(s)) return "Cumple con las condiciones";
        if (["NO_CUMPLE", "NOCUMPLE"].includes(s)) return "No cumple con las condiciones";
        return "REGULAR";
      }
      return "REGULAR";
    }
    camposValidos.forEach(campo => {
      if (optionFields.has(campo) && data[campo] !== undefined) {
        data[campo] = normalizeOption(data[campo], campo);
      }
    });
    const camposExcluidos = new Set(['equipo_limpio', 'equipo_limpio_observacion', 'embolos_empuje', 'embolos_empuje_observacion']);
    const campos = Object.keys(data).filter(key => camposValidos.includes(key) && !camposExcluidos.has(key));
    const valores = campos.map(key => data[key]);
    const placeholders = campos.map((_, i) => `$${i + 1}`).join(", ");
    if (campos.length === 0) {
      return res.status(400).json({ error: "No se enviaron campos válidos para la tabla checklist" });
    }
    const insertResult = await db.query(
      `INSERT INTO checklist (${campos.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      valores
    );
    const checklistId = insertResult.rows[0]?.id;

    // --- Datos de firmantes (opcional, enviados desde el frontend) ---
    const { 
      requiere_firma = false,
      firmante_principal,  // { nombre, cedula, email, celular }
      firmantes_externos   // [{ nombre, cedula, email, celular }, ...]
    } = req.body;

    // --- Generar PDF y enviar por correo ---
    // Reutiliza la función de checklist_admin.js para generar el PDF llenando checklist_admin_template.xlsx
    let pdfBuf = null;
    try {
      const adminModule = await import(process.cwd() + '/routes/administrador_bomberman/checklist_admin.js');
      const generarPDFPorChecklist = adminModule.generarPDFPorChecklist || (adminModule.default && adminModule.default.generarPDFPorChecklist);
      if (typeof generarPDFPorChecklist !== 'function') throw new Error('No se pudo importar la función generarPDFPorChecklist');
      
      // Incluir todos los campos del checklist para el PDF (compatibles con checklist_admin_template.xlsx)
      const datosPDF = {
        nombre_cliente: data.nombre_cliente || '',
        nombre_proyecto: data.nombre_proyecto || '',
        fecha_servicio: data.fecha_servicio || '',
        nombre_operador: data.nombre_operador || '',
        bomba_numero: data.bomba_numero || '',
        horometro_motor: data.horometro_motor || ''
      };
      if (data.empresa_id != null) datosPDF.empresa_id = data.empresa_id;
      if (data.observaciones) datosPDF.observaciones = data.observaciones;
      // Pasar todos los campos del checklist y sus observaciones al PDF
      Object.keys(data).forEach(campo => {
        if (camposValidos.includes(campo) && data[campo] !== undefined && data[campo] !== null) {
          datosPDF[campo] = data[campo];
        }
      });
      
      // Genera el PDF con todos los datos necesarios
      pdfBuf = await generarPDFPorChecklist(datosPDF);
      
      // Destinatarios: siempre dir.bombas + email del departamento según obra
      const correoFijo = 'dir.bombas@gruasyequipos.com';
      const correos = new Set([correoFijo]);
      try {
        const obraRes = await db.query(
          `SELECT o.departamento_id, d.email
           FROM obras o
           LEFT JOIN departamentos d ON d.id = o.departamento_id
           WHERE o.nombre_obra ILIKE $1
           LIMIT 1`,
          [data.nombre_proyecto || '']
        );
        if (obraRes.rows.length > 0 && obraRes.rows[0].email) {
          correos.add(obraRes.rows[0].email.trim());
        }
      } catch (qErr) {
        console.warn('No se pudo obtener email por departamento (tabla departamentos/obras puede no estar configurada):', qErr.message);
      }
      const destinatarios = [...correos].filter(Boolean).join(', ');

      // Enviar correo con PDF adjunto
      const nodemailer = await import('nodemailer');
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
        to: destinatarios,
        subject: 'Nuevo checklist registrado',
        text: 'Se ha registrado un nuevo checklist. Adjuntamos el PDF generado automáticamente.',
        attachments: [{ filename: 'checklist.pdf', content: pdfBuf }]
      });
    } catch (mailErr) {
      console.error('Error generando PDF o enviando correo:', mailErr);
    }

    // --- Enviar a firma electrónica si se requiere ---
    let resultadoFirma = null;
    if (requiere_firma && pdfBuf && firmante_principal) {
      try {
        // Enviar a Signio
        resultadoFirma = await enviarDocumentoAFirmar({
          nombre_documento: `Checklist de Bomba - ${data.nombre_cliente || 'Cliente'}`,
          external_id: `checklist_${checklistId}`,
          pdf: pdfBuf,
          nombre_archivo: `Checklist_${checklistId || 'sin_id'}_${formatDateOnly(new Date())}.pdf`,
          firmante_principal: {
            nombre: firmante_principal.nombre,
            tipo_identificacion: 'CC',
            identificacion: firmante_principal.cedula,
            email: firmante_principal.email,
            celular: firmante_principal.celular || null
          },
          firmantes_externos: Array.isArray(firmantes_externos) ? firmantes_externos.map(f => ({
            nombre: f.nombre,
            tipo_identificacion: 'CC',
            identificacion: f.cedula,
            email: f.email,
            celular: f.celular || null
          })) : []
        });

        // Guardar ID de transacción en la base de datos (si existe la columna)
        if (resultadoFirma.success && resultadoFirma.transaccion_id && checklistId) {
          try {
            await db.query(
              `UPDATE checklist SET signio_transaccion_id = $1 WHERE id = $2`,
              [resultadoFirma.transaccion_id, checklistId]
            );
          } catch (updateErr) {
            // La columna puede no existir, no es crítico
            console.log('Nota: No se pudo guardar signio_transaccion_id (columna puede no existir)');
          }
        }

      } catch (firmaErr) {
        console.error('Error enviando a firma electrónica:', firmaErr);
        resultadoFirma = { success: false, error: firmaErr.message };
      }
    }

    // Respuesta final
    const respuesta = { 
      message: "Checklist guardado correctamente y PDF enviado por correo",
      id: checklistId
    };

    if (requiere_firma) {
      if (resultadoFirma?.success) {
        respuesta.firma = {
          success: true,
          url_firma: resultadoFirma.url_firma,
          transaccion_id: resultadoFirma.transaccion_id,
          mensaje: "Documento enviado a firma electrónica"
        };
      } else {
        respuesta.firma = {
          success: false,
          error: resultadoFirma?.error || "No se pudo procesar la firma"
        };
      }
    }

    res.json(respuesta);
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
