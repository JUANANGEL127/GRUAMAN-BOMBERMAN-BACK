import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF as generarPDFHelper, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';

const router = Router();

// Middleware para verificar si la base de datos está disponible
router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de planillabombeo");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

// Formatea un valor de hora para garantizar que esté en formato HH:MM o HH:MM:SS
function formatTime(value) {
  // Si ya está en formato HH:MM o HH:MM:SS, lo retorna igual
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value;
  // Si es solo hora (ej: "8" o "15"), lo convierte a "08:00"
  if (/^\d{1,2}$/.test(value)) return value.padStart(2, "0") + ":00";
  // Si es hora y minutos sin separador (ej: "804"), lo convierte a "08:04"
  if (/^\d{3,4}$/.test(value)) {
    let h = value.length === 3 ? value.slice(0,1) : value.slice(0,2);
    let m = value.length === 3 ? value.slice(1) : value.slice(2);
    return h.padStart(2, "0") + ":" + m.padStart(2, "0");
  }
  return value; // Si no coincide, lo retorna igual (puede fallar en SQL)
}

// Genera un archivo PDF con la información de la planilla y las remisiones
async function generarPDF(planilla, remisiones) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      resolve(pdfData);
    });

    doc.on("error", (error) => {
      console.error("Error al generar el PDF:", error);
      reject(error);
    });

    try {
      // Título
      doc.fontSize(20).text("Planilla de Bombeo", { align: "center" });
      doc.moveDown();

      // Información de la planilla
      doc.fontSize(12).text(`Cliente: ${planilla.nombre_cliente || "N/A"}`);
      doc.text(`Proyecto: ${planilla.nombre_proyecto || "N/A"}`);
      doc.text(`Fecha de Servicio: ${planilla.fecha_servicio || "N/A"}`);
      doc.text(`Bomba Número: ${planilla.bomba_numero || "N/A"}`);
      doc.text(`Hora Llegada Obra: ${planilla.hora_llegada_obra || "N/A"}`);
      doc.text(`Hora Salida Obra: ${planilla.hora_salida_obra || "N/A"}`);
      doc.text(`Galones Inicio ACPM: ${planilla.galones_inicio_acpm || "N/A"}`);
      doc.text(`Galones Final ACPM: ${planilla.galones_final_acpm || "N/A"}`);
      doc.text(`Galones Pinpina: ${planilla.galones_pinpina || "N/A"}`);
      doc.text(`Horómetro Inicial: ${planilla.horometro_inicial || "N/A"}`);
      doc.text(`Horómetro Final: ${planilla.horometro_final || "N/A"}`);
      doc.text(`Operador: ${planilla.nombre_operador || "N/A"}`);
      doc.text(`Auxiliar: ${planilla.nombre_auxiliar || "N/A"}`);
      doc.text(`Total Metros Bombeados: ${planilla.total_metros_cubicos_bombeados || "N/A"}`);
      doc.moveDown();

      // Información de las remisiones
      if (remisiones && remisiones.length > 0) {
        doc.fontSize(14).text("Remisiones:");
        remisiones.forEach((rem, index) => {
          doc.fontSize(12).text(`Remisión ${index + 1}:`);
          doc.text(`  Número: ${rem.remision || "N/A"}`);
          doc.text(`  Hora Llegada: ${rem.hora_llegada || "N/A"}`);
          doc.text(`  Hora Inicial: ${rem.hora_inicial || "N/A"}`);
          doc.text(`  Hora Final: ${rem.hora_final || "N/A"}`);
          doc.text(`  Metros: ${rem.metros || "N/A"}`);
          doc.text(`  Observaciones: ${rem.observaciones || "N/A"}`);
          doc.text(`  Manguera: ${rem.manguera || "N/A"}`);
          doc.moveDown();
        });
      } else {
        doc.fontSize(14).text("No hay remisiones asociadas.", { align: "left" });
      }

      doc.end();
    } catch (error) {
      console.error("Error al escribir en el PDF:", error);
      reject(error);
    }
  });
}

// Envía un correo con el PDF generado como adjunto
async function enviarCorreo(destinatarios, pdfBuffer) {
  const transporter = nodemailer.createTransport({
    service: "gmail", // Usar el servicio de Gmail
    auth: {
      user: "davidl.lamprea810@gmail.com", // Correo proporcionado
      pass: "qeut vziy axsg rceb", // Contraseña de aplicación proporcionada
    },
  });

  await transporter.sendMail({
    from: '"Planilla de Bombeo" <davidl.lamprea810@gmail.com>', // Correo del remitente
    to: destinatarios.join(", "),
    subject: "Planilla de Bombeo",
    text: "Adjunto encontrarás la planilla de bombeo generada.",
    attachments: [
      {
        filename: "planilla_bombeo.pdf",
        content: pdfBuffer,
      },
    ],
  });
}

// Lista de correos fijos a los que se enviará el PDF
const correosFijos = [
  "desarrolloit@gruasyequipos.com"
];

// Endpoint para guardar una nueva planilla de bombeo
router.post("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en POST /bomberman/planillabombeo");
    return res.status(500).json({ error: "DB no disponible" });
  }

  let {
    nombre_cliente,
    nombre_proyecto,
    fecha_servicio,
    bomba_numero,
    hora_llegada_obra,
    hora_salida_obra,
    galones_inicio_acpm,
    galones_final_acpm,
    galones_pinpina,
    horometro_inicial,
    horometro_final,
    nombre_operador,
    nombre_auxiliar,
    total_metros_cubicos_bombeados,
    remisiones,
  } = req.body;

  // Verificar los datos recibidos
  console.log("Datos de la planilla:", {
    nombre_cliente,
    nombre_proyecto,
    fecha_servicio,
    bomba_numero,
    hora_llegada_obra,
    hora_salida_obra,
    galones_inicio_acpm,
    galones_final_acpm,
    galones_pinpina,
    horometro_inicial,
    horometro_final,
    nombre_operador,
    nombre_auxiliar,
    total_metros_cubicos_bombeados,
  });
  console.log("Remisiones recibidas:", remisiones);

  // Formatear solo los campos TIME correctos
  hora_llegada_obra = formatTime(hora_llegada_obra);
  hora_salida_obra = formatTime(hora_salida_obra);

  // Validar parámetros obligatorios
  if (
    !nombre_cliente || !nombre_proyecto || !fecha_servicio || !bomba_numero ||
    !hora_llegada_obra || !hora_salida_obra ||
    galones_inicio_acpm == null || galones_final_acpm == null ||
    galones_pinpina == null || // <-- validación nuevo campo
    horometro_inicial == null || horometro_final == null ||
    !nombre_operador || !nombre_auxiliar || total_metros_cubicos_bombeados == null ||
    !Array.isArray(remisiones) || remisiones.length === 0
  ) {
    return res.status(400).json({ error: "Faltan parámetros obligatorios o remisiones no es un array válido" });
  }

  try {
    // 1. Insertar la planilla de bombeo
    const result = await db.query(
      `INSERT INTO planilla_bombeo 
        (nombre_cliente, nombre_proyecto, fecha_servicio, bomba_numero, hora_llegada_obra, hora_salida_obra, galones_inicio_acpm, galones_final_acpm, galones_pinpina, horometro_inicial, horometro_final, nombre_operador, nombre_auxiliar, total_metros_cubicos_bombeados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        nombre_cliente,
        nombre_proyecto,
        fecha_servicio,
        bomba_numero,
        hora_llegada_obra,
        hora_salida_obra,
        galones_inicio_acpm,
        galones_final_acpm,
        galones_pinpina, // <-- nuevo campo
        horometro_inicial,
        horometro_final,
        nombre_operador,
        nombre_auxiliar,
        total_metros_cubicos_bombeados
      ]
    );
    const planillaId = result.rows[0].id;

    // 2. Insertar cada remisión asociada
    for (const rem of remisiones) {
      const {
        remision,
        hora_llegada,
        hora_inicial,
        hora_final,
        metros,
        observaciones,
        manguera // <-- nuevo campo
      } = rem;

      // Formatear los campos TIME de la remisión
      const hora_llegada_fmt = formatTime(hora_llegada);
      const hora_inicial_fmt = formatTime(hora_inicial);
      const hora_final_fmt = formatTime(hora_final);

      // Validar campos de la remisión
      if (
        !remision || !hora_llegada || !hora_inicial || !hora_final || metros == null || !manguera 
      ) {
        return res.status(400).json({ error: "Faltan campos obligatorios en una remisión" });
      }

      await db.query(
        `INSERT INTO remisiones 
          (planilla_bombeo_id, remision, hora_llegada, hora_inicial, hora_final, metros, observaciones, manguera)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          planillaId,
          remision,
          hora_llegada_fmt,
          hora_inicial_fmt,
          hora_final_fmt,
          metros,
          observaciones ?? "",
          manguera
        ]
      );
    }

    // Obtener la información completa de la planilla y sus remisiones
    const planilla = {
      nombre_cliente,
      nombre_proyecto,
      fecha_servicio,
      bomba_numero,
      hora_llegada_obra,
      hora_salida_obra,
      galones_inicio_acpm,
      galones_final_acpm,
      galones_pinpina,
      horometro_inicial,
      horometro_final,
      nombre_operador,
      nombre_auxiliar,
      total_metros_cubicos_bombeados,
    };

    // Generar el PDF
    const pdfBuffer = await generarPDF(planilla, remisiones);

    // Enviar el correo a los correos fijos
    await enviarCorreo(correosFijos, pdfBuffer);

    res.json({ message: "Registro guardado y correos enviados correctamente", planilla_bombeo_id: planillaId });
  } catch (error) {
    console.error("Error al guardar el registro o enviar correos:", error);
    res.status(500).json({ error: "Error al guardar el registro o enviar correos", detalle: error.message });
  }
});

// Endpoint para obtener todas las planillas de bombeo
router.get("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en GET /bomberman/planillabombeo");
    return res.status(500).json({ error: "DB no disponible" });
  }
  try {
    // Obtener todas las planillas
    const result = await db.query(`SELECT * FROM planilla_bombeo`);
    const planillas = result.rows;

    // Obtener todas las remisiones asociadas, incluyendo manguera
    const remisionesResult = await db.query(`SELECT * FROM remisiones`);
    const remisiones = remisionesResult.rows;

    // Asociar remisiones a cada planilla
    const planillasConRemisiones = planillas.map(planilla => ({
      ...planilla,
      remisiones: remisiones
        .filter(r => r.planilla_bombeo_id === planilla.id)
        .map(r => ({
          ...r,
          manguera: r.manguera // asegúrate que el campo esté presente
        }))
    }));

    res.json({ registros: planillasConRemisiones });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros", detalle: error.message });
  }
});

// Endpoint para exportar las planillas de bombeo a un archivo Excel
router.get("/exportar", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en GET /bomberman/planillabombeo/exportar");
    return res.status(500).json({ error: "DB no disponible" });
  }

  try {
    // Consulta los datos de planilla_bombeo
    const result = await db.query(`SELECT * FROM planilla_bombeo`);
    const planillas = result.rows;

    // Consulta las remisiones asociadas
    const remisionesResult = await db.query(`SELECT * FROM remisiones`);
    const remisiones = remisionesResult.rows;

    // Crea un nuevo libro de Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Planillas de Bombeo");

    // Define las columnas del archivo Excel
    worksheet.columns = [
      { header: "ID", key: "id", width: 10 },
      { header: "Nombre Cliente", key: "nombre_cliente", width: 30 },
      { header: "Nombre Proyecto", key: "nombre_proyecto", width: 30 },
      { header: "Fecha Servicio", key: "fecha_servicio", width: 15 },
      { header: "Bomba Número", key: "bomba_numero", width: 15 },
      { header: "Hora Llegada Obra", key: "hora_llegada_obra", width: 20 },
      { header: "Hora Salida Obra", key: "hora_salida_obra", width: 20 },
      { header: "Galones Inicio ACPM", key: "galones_inicio_acpm", width: 20 },
      { header: "Galones Final ACPM", key: "galones_final_acpm", width: 20 },
      { header: "Galones Pinpina", key: "galones_pinpina", width: 20 },
      { header: "Horómetro Inicial", key: "horometro_inicial", width: 20 },
      { header: "Horómetro Final", key: "horometro_final", width: 20 },
      { header: "Nombre Operador", key: "nombre_operador", width: 30 },
      { header: "Nombre Auxiliar", key: "nombre_auxiliar", width: 30 },
      { header: "Total Metros Bombeados", key: "total_metros_cubicos_bombeados", width: 25 },
      { header: "Remisiones", key: "remisiones", width: 50 }
    ];

    // Agrega las filas con los datos
    planillas.forEach(planilla => {
      const remisionesAsociadas = remisiones
        .filter(r => r.planilla_bombeo_id === planilla.id)
        .map(r => `Remisión: ${r.remision}, Manguera: ${r.manguera}, Metros: ${r.metros}`)
        .join(" | ");

      worksheet.addRow({
        ...planilla,
        remisiones: remisionesAsociadas
      });
    });

    
    // Configura el archivo para ser descargado
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=planillas_bombeo.xlsx");

    // Escribe el archivo en el stream de respuesta
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error al exportar planillas:", error);
    res.status(500).json({ error: "Error al exportar planillas", detalle: error.message });
  }
});

export default router;
