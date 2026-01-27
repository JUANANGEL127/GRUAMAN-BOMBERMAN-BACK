import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import libre from 'libreoffice-convert';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Formatea una fecha a string "YYYY-MM-DD" de forma segura (evita shift TZ)
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
 * Busca el template en varias rutas posibles
 * @param {string} templateName - Nombre del archivo template (ej: 'checklist_admin_template.xlsx')
 * @returns {string|null} - Ruta completa del template o null si no se encuentra
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
 * Genera un PDF a partir de un template XLSX/DOC reemplazando placeholders {{campo}}
 * 
 * @param {string} templateName - Nombre del archivo template (ej: 'permiso_trabajo_template.xlsx')
 * @param {Object} datos - Objeto con los datos a insertar en el template
 * @returns {Promise<Buffer>} - Buffer del PDF generado
 * 
 * @example
 * const pdfBuffer = await generarPDF('permiso_trabajo_template.xlsx', {
 *   nombre_cliente: 'Constructora ABC',
 *   nombre_proyecto: 'Edificio Central',
 *   fecha_servicio: '2026-01-26',
 *   nombre_operador: 'Juan Pérez'
 * });
 */
export async function generarPDF(templateName, datos) {
  try {
    // Buscar el template en las rutas posibles
    const tplPath = buscarTemplate(templateName);
    if (!tplPath) {
      throw new Error(`Template "${templateName}" no encontrado en ninguna ruta esperada.`);
    }

    // Leer el workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(tplPath);

    // Preparar los datos para reemplazar
    const data = {};
    Object.keys(datos).forEach(k => {
      let v = datos[k];
      // Formatear fechas
      if (k.includes('fecha') || k === 'fecha_servicio') {
        v = v ? formatDateOnly(v) : '';
      } else if (v === null || v === undefined) {
        v = '';
      } else if (typeof v === 'object') {
        try { v = JSON.stringify(v); } catch(e) { v = String(v); }
      }
      data[k] = String(v);
    });

    // Reemplazar placeholders {{campo}} en todas las celdas
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

    // Convertir a buffer XLSX
    const xlsxBuf = await workbook.xlsx.writeBuffer();

    // Verificar que LibreOffice esté disponible
    const sofficePath = process.env.LIBREOFFICE_PATH || "/Applications/LibreOffice.app/Contents/MacOS/soffice";
    if (!fs.existsSync(sofficePath)) {
      throw new Error('LibreOffice (soffice) no está instalado. No es posible generar PDF.');
    }

    // Convertir XLSX a PDF con LibreOffice
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
 * Genera un PDF y lo envía a Signio para firma electrónica
 * 
 * @param {Object} params
 * @param {string} params.templateName - Nombre del template XLSX
 * @param {Object} params.datos - Datos del formulario para el template
 * @param {string} params.nombre_documento - Nombre del documento en Signio
 * @param {string} params.external_id - ID interno para relacionar con tu BD
 * @param {Object} params.firmante_principal - Datos del firmante principal
 * @param {Array} params.firmantes_externos - Array de firmantes externos (opcional)
 * 
 * @returns {Promise<Object>} - { success, id_transaccion, url_firma, pdfBuffer }
 * 
 * @example
 * const resultado = await generarPDFYEnviarAFirmar({
 *   templateName: 'permiso_trabajo_template.xlsx',
 *   datos: { nombre_cliente: 'ABC', ... },
 *   nombre_documento: 'Permiso de Trabajo - 2026-01-26',
 *   external_id: 'permiso_trabajo_123',
 *   firmante_principal: {
 *     nombre: 'Juan Pérez',
 *     tipo_identificacion: 'CC',
 *     identificacion: '123456789',
 *     email: 'juan@email.com',
 *     celular: '573001234567'
 *   },
 *   firmantes_externos: [
 *     { nombre: 'Carlos', identificacion: '987654321', email: 'carlos@obra.com' }
 *   ]
 * });
 */
export async function generarPDFYEnviarAFirmar({
  templateName,
  datos,
  nombre_documento,
  external_id,
  firmante_principal,
  firmantes_externos = []
}) {
  // Importar dinámicamente para evitar dependencias circulares
  const { enviarDocumentoAFirmar } = await import('../routes/signio.js');

  try {
    // 1. Generar el PDF
    const pdfBuffer = await generarPDF(templateName, datos);

    // 2. Enviar a Signio para firma
    const resultado = await enviarDocumentoAFirmar({
      nombre_documento,
      external_id,
      pdf: pdfBuffer,
      nombre_archivo: `${nombre_documento.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`,
      firmante_principal,
      firmantes_externos
    });

    // 3. Retornar resultado con el buffer del PDF
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
