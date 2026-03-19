import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import libre from 'libreoffice-convert';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Formatea cualquier entrada de fecha a "YYYY-MM-DD" sin desplazamiento de zona horaria.
 * @param {Date|string|null} input
 * @returns {string|null}
 */
function formatDateOnly(input) {
  if (!input) return null;
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const d = input;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  const s = String(input).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Resuelve la ruta absoluta de un archivo de plantilla buscando en los directorios conocidos.
 * @param {string} templateName - Nombre del archivo de plantilla (ej. `checklist_admin_template.xlsx`).
 * @returns {string|null} Ruta resuelta o null si no se encontró en ninguna ubicación candidata.
 */
function buscarTemplate(templateName) {
  const candidatePaths = [
    path.join(process.cwd(), 'templates', templateName),
    path.join(process.cwd(), 'routes', 'templates', templateName),
    path.join(process.cwd(), 'routes', 'administrador_bomberman', 'templates', templateName),
    path.join(process.cwd(), 'routes', 'adminsitrador_gruaman', 'templates', templateName),
    path.join(process.cwd(), 'routes', 'compartido', 'templates', templateName),
    path.join(process.cwd(), 'routes', 'gruaman', 'templates', templateName),
    path.join(process.cwd(), 'routes', 'bomberman', 'templates', templateName)
  ];

  return candidatePaths.find(p => fs.existsSync(p)) || null;
}

/**
 * Genera un buffer PDF a partir de una plantilla XLSX sustituyendo los marcadores `{{campo}}`.
 * Requiere que LibreOffice (soffice) esté instalado y accesible mediante `LIBREOFFICE_PATH`
 * o la ruta predeterminada de macOS.
 *
 * @param {string} templateName - Nombre del archivo de plantilla XLSX.
 * @param {Object} datos - Pares clave/valor usados para reemplazar los marcadores en la plantilla.
 * @returns {Promise<Buffer>} Buffer del PDF.
 * @throws {Error} Si no se encuentra la plantilla o LibreOffice no está disponible.
 *
 * @example
 * const buf = await generarPDF('permiso_trabajo_template.xlsx', {
 *   nombre_cliente: 'Constructora ABC',
 *   fecha_servicio: '2026-01-26',
 * });
 */
export async function generarPDF(templateName, datos) {
  try {
    const tplPath = buscarTemplate(templateName);
    if (!tplPath) {
      throw new Error(`Template "${templateName}" no encontrado en ninguna ruta esperada.`);
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(tplPath);

    const data = {};
    Object.keys(datos).forEach(k => {
      let v = datos[k];
      if (k.includes('fecha') || k === 'fecha_servicio') {
        v = v ? formatDateOnly(v) : '';
      } else if (v === null || v === undefined) {
        v = '';
      } else if (typeof v === 'object') {
        try { v = JSON.stringify(v); } catch(e) { v = String(v); }
      }
      data[k] = String(v);
    });

    workbook.eachSheet(sheet => {
      sheet.eachRow(row => {
        row.eachCell(cell => {
          if (typeof cell.value === 'string') {
            cell.value = cell.value.replace(/{{\s*([\w]+)\s*}}/g, (m, p1) =>
              (data[p1] !== undefined ? data[p1] : '')
            );
          } else if (cell.value && typeof cell.value === 'object' && cell.value.richText) {
            const txt = cell.value.richText.map(t => t.text).join('');
            const replaced = txt.replace(/{{\s*([\w]+)\s*}}/g, (m, p1) =>
              (data[p1] !== undefined ? data[p1] : '')
            );
            cell.value = replaced;
          }
        });
      });
    });

    const xlsxBuf = await workbook.xlsx.writeBuffer();

    const sofficePath = process.env.LIBREOFFICE_PATH || "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    if (!fs.existsSync(sofficePath)) {
      throw new Error('LibreOffice (soffice) no está instalado. No es posible generar PDF.');
    }

    const pdfBuf = await new Promise((resolve, reject) => {
      libre.convert(xlsxBuf, '.pdf', undefined, (err, done) => {
        if (err) return reject(err);
        resolve(done);
      });
    });

    return pdfBuf;

  } catch (err) {
    console.error('Error en generarPDF:', err);
    throw err;
  }
}

/**
 * Genera un PDF a partir de una plantilla XLSX y lo envía a Signio para firma electrónica.
 *
 * @param {Object} params
 * @param {string} params.templateName - Nombre del archivo de plantilla XLSX.
 * @param {Object} params.datos - Datos de marcadores para la plantilla.
 * @param {string} params.nombre_documento - Nombre visible del documento en Signio.
 * @param {string} params.external_id - Identificador interno para correlacionar con registros locales.
 * @param {Object} params.firmante_principal - Datos del firmante principal (nombre, identificacion, email, celular).
 * @param {Array}  [params.firmantes_externos=[]] - Firmantes adicionales.
 * @returns {Promise<{ success: boolean, id_transaccion?: string, url_firma?: string, pdfBuffer?: Buffer, error?: string }>}
 */
export async function generarPDFYEnviarAFirmar({
  templateName,
  datos,
  nombre_documento,
  external_id,
  firmante_principal,
  firmantes_externos = []
}) {
  const { enviarDocumentoAFirmar } = await import('../routes/signio.js');

  try {
    const pdfBuffer = await generarPDF(templateName, datos);

    const resultado = await enviarDocumentoAFirmar({
      nombre_documento,
      external_id,
      pdf: pdfBuffer,
      nombre_archivo: `${nombre_documento.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
      firmante_principal,
      firmantes_externos
    });

    return {
      ...resultado,
      pdfBuffer
    };

  } catch (error) {
    console.error('Error en generarPDFYEnviarAFirmar:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default {
  generarPDF,
  generarPDFYEnviarAFirmar
};
