import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import { enviarDocumentoAFirmar } from '../signio.js';
import { generarPDF as generarPDFHelper, generarPDFYEnviarAFirmar } from '../../helpers/pdfGenerator.js';

const router = Router();

router.use((req, res, next) => {
  if (!global.db) {
    console.error("DB no disponible en middleware de planillabombeo");
    return res.status(503).json({ error: "Base de datos no inicializada. Intenta nuevamente en unos segundos." });
  }
  next();
});

/**
 * Lista fija de destinatarios para los correos de planillas de bombeo salientes.
 * @type {string[]}
 */
const correosFijos = [
  "desarrolloit@gruasyequipos.com"
];

/**
 * Normaliza una cadena de hora cruda al formato "HH:MM" o "HH:MM:SS".
 * Acepta "HH:MM", "HH:MM:SS", un dígito de hora suelto, o una secuencia de 3 a 4 dígitos.
 * Retorna la cadena original sin cambios si ningún patrón coincide.
 * @param {string} value
 * @returns {string}
 */
function formatTime(value) {
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return value;
  if (/^\d{1,2}$/.test(value)) return value.padStart(2, "0") + ":00";
  if (/^\d{3,4}$/.test(value)) {
    let h = value.length === 3 ? value.slice(0,1) : value.slice(0,2);
    let m = value.length === 3 ? value.slice(1) : value.slice(2);
    return h.padStart(2, "0") + ":" + m.padStart(2, "0");
  }
  return value;
}

/**
 * Genera un buffer PDF con el resumen de una planilla de bombeo y sus remisiones asociadas.
 * @param {object} planilla - Datos del encabezado de la planilla de bombeo.
 * @param {Array<object>} remisiones - Lista de registros de remisión vinculados a la planilla.
 * @returns {Promise<Buffer>}
 */
async function generarPDF(planilla, remisiones) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", (error) => {
      console.error("Error al generar el PDF:", error);
      reject(error);
    });

    try {
      doc.fontSize(20).text("Planilla de Bombeo", { align: "center" });
      doc.moveDown();

      doc.fontSize(12).text(`Cliente: ${planilla.nombre_cliente || "N/A"}`);
      doc.text(`Proyecto: ${planilla.nombre_proyecto || "N/A"}`);
      doc.text(`Fecha de Servicio: ${planilla.fecha_servicio || "N/A"}`);
      doc.text(`Bomba Número: ${planilla.bomba_numero || "N/A"}`);
      doc.text(`Galones Inicio ACPM: ${planilla.galones_inicio_acpm || "N/A"}`);
      doc.text(`Galones Final ACPM: ${planilla.galones_final_acpm || "N/A"}`);
      doc.text(`Galones Pinpina: ${planilla.galones_pinpina || "N/A"}`);
      doc.text(`Horómetro Inicial: ${planilla.horometro_inicial || "N/A"}`);
      doc.text(`Horómetro Final: ${planilla.horometro_final || "N/A"}`);
      doc.text(`Operador: ${planilla.nombre_operador || "N/A"}`);
      doc.text(`Auxiliar: ${planilla.nombre_auxiliar || "N/A"}`);
      doc.text(`Total Metros Bombeados: ${planilla.total_metros_cubicos_bombeados || "N/A"}`);
      doc.moveDown();

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

/**
 * Envía un PDF de planilla de bombeo a los destinatarios indicados por correo electrónico.
 * Usa credenciales de Gmail hardcodeadas — deben migrarse a variables de entorno.
 * @param {string[]} destinatarios
 * @param {Buffer} pdfBuffer
 * @returns {Promise<void>}
 */
async function enviarCorreo(destinatarios, pdfBuffer) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "davidl.lamprea810@gmail.com",
      pass: "qeut vziy axsg rceb",
    },
  });

  await transporter.sendMail({
    from: '"Planilla de Bombeo" <davidl.lamprea810@gmail.com>',
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

/**
 * POST /bomberman/planillabombeo
 * Inserta un registro de planilla de bombeo junto con sus remisiones asociadas,
 * genera un resumen en PDF y lo envía por correo electrónico.
 * Las remisiones se validan individualmente: `remision`, `hora_llegada`, `hora_inicial`,
 * `hora_final`, `metros` y `manguera` son obligatorios en cada entrada.
 * @body {{ nombre_cliente: string, nombre_proyecto: string, fecha_servicio: string, bomba_numero: string, galones_inicio_acpm: number, galones_final_acpm: number, galones_pinpina: number, horometro_inicial: number, horometro_final: number, nombre_operador: string, nombre_auxiliar: string, total_metros_cubicos_bombeados: number, remisiones: Array<{ remision: string, hora_llegada: string, hora_inicial: string, hora_final: string, metros: number, manguera: string, observaciones?: string }> }}
 * @returns {{ message: string, planilla_bombeo_id: number }}
 * @throws {400} Si faltan campos requeridos o las remisiones están ausentes o mal formadas.
 */
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

  const faltantes = [];
  if (!nombre_cliente) faltantes.push("nombre_cliente");
  if (!nombre_proyecto) faltantes.push("nombre_proyecto");
  if (!fecha_servicio) faltantes.push("fecha_servicio");
  if (!bomba_numero) faltantes.push("bomba_numero");
  if (galones_inicio_acpm == null || galones_inicio_acpm === "") faltantes.push("galones_inicio_acpm");
  if (galones_final_acpm == null || galones_final_acpm === "") faltantes.push("galones_final_acpm");
  if (galones_pinpina == null || galones_pinpina === "") faltantes.push("galones_pinpina");
  if (horometro_inicial == null || horometro_inicial === "") faltantes.push("horometro_inicial");
  if (horometro_final == null || horometro_final === "") faltantes.push("horometro_final");
  if (!nombre_operador) faltantes.push("nombre_operador");
  if (!nombre_auxiliar) faltantes.push("nombre_auxiliar");
  if (total_metros_cubicos_bombeados == null || total_metros_cubicos_bombeados === "") faltantes.push("total_metros_cubicos_bombeados");
  if (!Array.isArray(remisiones)) faltantes.push("remisiones (debe ser un array)");
  else if (remisiones.length === 0) faltantes.push("remisiones (array vacío, debe tener al menos una)");

  if (faltantes.length > 0) {
    return res.status(400).json({
      error: "Faltan parámetros obligatorios o remisiones no es un array válido",
      faltantes
    });
  }

  try {
    const result = await db.query(
      `INSERT INTO planilla_bombeo
        (nombre_cliente, nombre_proyecto, fecha_servicio, bomba_numero, galones_inicio_acpm, galones_final_acpm, galones_pinpina, horometro_inicial, horometro_final, nombre_operador, nombre_auxiliar, total_metros_cubicos_bombeados)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        nombre_cliente,
        nombre_proyecto,
        fecha_servicio,
        bomba_numero,
        galones_inicio_acpm,
        galones_final_acpm,
        galones_pinpina,
        horometro_inicial,
        horometro_final,
        nombre_operador,
        nombre_auxiliar,
        total_metros_cubicos_bombeados
      ]
    );
    const planillaId = result.rows[0].id;

    for (const rem of remisiones) {
      const {
        remision,
        hora_llegada,
        hora_inicial,
        hora_final,
        metros,
        observaciones,
        manguera
      } = rem;

      const hora_llegada_fmt = formatTime(hora_llegada);
      const hora_inicial_fmt = formatTime(hora_inicial);
      const hora_final_fmt = formatTime(hora_final);

      if (!remision || !hora_llegada || !hora_inicial || !hora_final || metros == null || !manguera) {
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

    const planilla = {
      nombre_cliente, nombre_proyecto, fecha_servicio, bomba_numero,
      galones_inicio_acpm, galones_final_acpm, galones_pinpina,
      horometro_inicial, horometro_final, nombre_operador, nombre_auxiliar,
      total_metros_cubicos_bombeados,
    };

    const pdfBuffer = await generarPDF(planilla, remisiones);
    await enviarCorreo(correosFijos, pdfBuffer);

    res.json({ message: "Registro guardado y correos enviados correctamente", planilla_bombeo_id: planillaId });
  } catch (error) {
    console.error("Error al guardar el registro o enviar correos:", error);
    res.status(500).json({ error: "Error al guardar el registro o enviar correos", detalle: error.message });
  }
});

/**
 * GET /bomberman/planillabombeo
 * Retorna todos los registros de planilla de bombeo con sus remisiones asociadas anidadas por planilla.
 * @returns {{ registros: Array<object & { remisiones: Array }> }}
 */
router.get("/", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en GET /bomberman/planillabombeo");
    return res.status(500).json({ error: "DB no disponible" });
  }
  try {
    const result = await db.query(`SELECT * FROM planilla_bombeo`);
    const planillas = result.rows;

    const remisionesResult = await db.query(`SELECT * FROM remisiones`);
    const remisiones = remisionesResult.rows;

    const planillasConRemisiones = planillas.map(planilla => ({
      ...planilla,
      remisiones: remisiones
        .filter(r => r.planilla_bombeo_id === planilla.id)
        .map(r => ({ ...r, manguera: r.manguera }))
    }));

    res.json({ registros: planillasConRemisiones });
  } catch (error) {
    res.status(500).json({ error: "Error al obtener los registros", detalle: error.message });
  }
});

/**
 * GET /bomberman/planillabombeo/exportar
 * Transmite todos los registros de planillas de bombeo y sus remisiones como un archivo XLSX.
 * @returns {Buffer} Adjunto de libro Excel (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
 */
router.get("/exportar", async (req, res) => {
  const db = global.db;
  if (!db) {
    console.error("DB no disponible en GET /bomberman/planillabombeo/exportar");
    return res.status(500).json({ error: "DB no disponible" });
  }

  try {
    const result = await db.query(`SELECT * FROM planilla_bombeo`);
    const planillas = result.rows;

    const remisionesResult = await db.query(`SELECT * FROM remisiones`);
    const remisiones = remisionesResult.rows;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Planillas de Bombeo");

    const colDefs = [
      { key: 'id', header: 'ID', width: 10 },
      { key: 'nombre_cliente', header: 'Nombre Cliente', width: 30 },
      { key: 'nombre_proyecto', header: 'Nombre Proyecto', width: 30 },
      { key: 'fecha_servicio', header: 'Fecha Servicio', width: 15 },
      { key: 'bomba_numero', header: 'Bomba Número', width: 15 },
      { key: 'galones_inicio_acpm', header: 'Galones Inicio ACPM', width: 22 },
      { key: 'galones_final_acpm', header: 'Galones Final ACPM', width: 20 },
      { key: 'galones_pinpina', header: 'Galones Pinpina', width: 18 },
      { key: 'horometro_inicial', header: 'Horómetro Inicial', width: 20 },
      { key: 'horometro_final', header: 'Horómetro Final', width: 18 },
      { key: 'nombre_operador', header: 'Nombre Operador', width: 30 },
      { key: 'nombre_auxiliar', header: 'Nombre Auxiliar', width: 30 },
      { key: 'total_metros_cubicos_bombeados', header: 'Total Metros Bombeados', width: 25 },
      { key: 'remisiones', header: 'Remisiones', width: 50 }
    ];

    worksheet.addTable({
      name: 'TablaPlanillasBombeo',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: colDefs.map(c => ({ name: c.header, filterButton: true })),
      rows: planillas.map(planilla => {
        const remisionesAsociadas = remisiones
          .filter(r => r.planilla_bombeo_id === planilla.id)
          .map(r => `Remisión: ${r.remision}, Manguera: ${r.manguera}, Metros: ${r.metros}`)
          .join(" | ");
        return colDefs.map(c => {
          if (c.key === 'remisiones') return remisionesAsociadas;
          const val = planilla[c.key];
          return val !== null && val !== undefined ? val : '';
        });
      })
    });
    colDefs.forEach((c, i) => { worksheet.getColumn(i + 1).width = c.width; });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=planillas_bombeo.xlsx");
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Error al exportar planillas:", error);
    res.status(500).json({ error: "Error al exportar planillas", detalle: error.message });
  }
});

export default router;
