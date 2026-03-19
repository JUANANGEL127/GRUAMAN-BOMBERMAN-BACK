import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { PDFDocument } from 'pdf-lib';

const router = express.Router();

/**
 * Caché del token para evitar solicitudes de autenticación redundantes.
 * Las entradas expiran después de 1h50m para contemplar el TTL de 2h del token de Signio.
 * @type {{ token: string|null, expiresAt: Date|null }}
 */
let tokenCache = {
  token: null,
  expiresAt: null
};

/**
 * Retorna la URL base de la API de Signio configurada.
 * @returns {string}
 */
function getSignioApiUrl() {
  return process.env.SIGNIO_API_URL || 'https://signio.stage.legops.com/api/v2';
}

/**
 * Obtiene un token Bearer de Signio, usando el caché en memoria cuando es válido.
 * @returns {Promise<string>} Cadena del token Bearer.
 * @throws {Error} Si el endpoint de autenticación de Signio retorna un código distinto de cero.
 */
async function getSignioToken() {
  if (tokenCache.token && tokenCache.expiresAt && new Date() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const signioEmail = process.env.SIGNIO_EMAIL;
  const signioPassword = process.env.SIGNIO_PASSWORD;
  const signioApiUrl = getSignioApiUrl();

  console.log('Signio Auth - Email:', signioEmail);
  console.log('Signio Auth - Password:', signioPassword ? '***SET***' : 'NOT SET');
  console.log('Signio Auth - URL:', `${signioApiUrl}/token/crear`);

  const response = await fetch(`${signioApiUrl}/token/crear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: signioEmail, password: signioPassword })
  });

  const data = await response.json();
  console.log('Signio Auth - Response:', JSON.stringify(data));

  if (data.codigo !== '00') {
    throw new Error(`Error al obtener token de Signio: ${data.mensaje}`);
  }

  tokenCache.token = data.token;
  tokenCache.expiresAt = new Date(Date.now() + 110 * 60 * 1000);

  return data.token;
}

/**
 * Crea una transacción (sobre) en Signio.
 * @param {string} token - Token Bearer.
 * @param {string} nombre - Nombre visible de la transacción.
 * @param {string} externalId - ID de referencia externo.
 * @returns {Promise<string>} ID de transacción de Signio.
 * @throws {Error} Si la API retorna un código distinto de cero.
 */
async function crearTransaccion(token, nombre, externalId) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/crear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      nombre,
      external_id: externalId,
      op_token: 'SCREEN',
      op_foto: 'NO',
      op_btnRechazo: 0,
      on_premise_signature: 1
    })
  });

  const data = await response.json();
  if (data.codigo !== '00') {
    throw new Error(`Error al crear transacción: ${data.mensaje}`);
  }
  return data.id_transaccion;
}

/**
 * Carga un documento PDF a una transacción existente en Signio.
 * @param {string} token - Token Bearer.
 * @param {string} idTransaccion - ID de la transacción destino.
 * @param {Buffer} pdfBuffer - Contenido del archivo PDF.
 * @param {string} nombreArchivo - Nombre del archivo para la carga.
 * @returns {Promise<string>} ID del documento en Signio.
 * @throws {Error} Si la API retorna un código distinto de cero.
 */
async function cargarDocumento(token, idTransaccion, pdfBuffer, nombreArchivo) {
  const formData = new FormData();
  formData.append('id_transaccion', idTransaccion);
  formData.append('documento', pdfBuffer, {
    filename: nombreArchivo,
    contentType: 'application/pdf'
  });

  const response = await fetch(`${getSignioApiUrl()}/transacciones/cargar_documento`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      ...formData.getHeaders()
    },
    body: formData
  });

  const data = await response.json();
  if (data.codigo !== '00') {
    throw new Error(`Error al cargar documento: ${data.mensaje}`);
  }
  return data.id_documento;
}

/**
 * Registra un firmante en una transacción.
 * @param {string} token - Token Bearer.
 * @param {string} idTransaccion - ID de la transacción destino.
 * @param {{ nombre: string, tipo_identificacion?: string, identificacion: string, email: string, celular?: string, rol?: string }} firmante
 * @param {number} orden - Orden de firma (1 = primero).
 * @returns {Promise<string>} ID del firmante en Signio.
 * @throws {Error} Si la API retorna un código distinto de cero.
 */
async function registrarFirmante(token, idTransaccion, firmante, orden) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/registrar_contacto`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      id_transaccion: idTransaccion,
      nombre: firmante.nombre,
      tipo_identificacion: firmante.tipo_identificacion || 'CC',
      identificacion: firmante.identificacion,
      email: firmante.email,
      celular: firmante.celular || null,
      orden,
      operation_rol: firmante.rol || null
    })
  });

  const data = await response.json();
  if (data.codigo !== '00') {
    throw new Error(`Error al registrar firmante ${firmante.nombre}: ${data.mensaje}`);
  }
  return data.id_firmante;
}

/**
 * Vincula un firmante a un documento dentro de una transacción, opcionalmente en una posición específica.
 * @param {string} token - Token Bearer.
 * @param {string} idTransaccion
 * @param {string} idFirmante
 * @param {string} idDocumento
 * @param {{ pagina: number, x: number, y: number, ancho: number, alto: number }|null} [posicion]
 * @returns {Promise<true>}
 * @throws {Error} Si la API retorna un código distinto de cero.
 */
async function vincularFirmanteDocumento(token, idTransaccion, idFirmante, idDocumento, posicion = null) {
  const body = {
    id_transaccion: idTransaccion,
    id_firmante: idFirmante,
    id_documento: idDocumento
  };

  if (posicion) {
    body.posicion = posicion;
  }

  const response = await fetch(`${getSignioApiUrl()}/transacciones/vincular`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (data.codigo !== '00') {
    throw new Error(`Error al vincular firmante: ${data.mensaje}`);
  }
  return true;
}

/**
 * Distribuye una transacción, disparando notificaciones por correo a los firmantes externos.
 * @param {string} token - Token Bearer.
 * @param {string} idTransaccion
 * @returns {Promise<true>}
 * @throws {Error} Si la API retorna un código distinto de cero.
 */
async function distribuirTransaccion(token, idTransaccion) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/distribuir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ id_transaccion: idTransaccion })
  });

  const data = await response.json();
  if (data.codigo !== '00') {
    throw new Error(`Error al distribuir transacción: ${data.mensaje}`);
  }
  return true;
}

/**
 * Genera una URL de firma on-premise para firma directa en el navegador (Signio v6.24+).
 * Retorna null sin errores si el endpoint no está disponible en el entorno actual.
 * @param {string} token - Token Bearer.
 * @param {string} idTransaccion
 * @param {string} tipoIdentificacion - Tipo de documento (ej. "CC").
 * @param {string} identificacion - Número de identificación.
 * @returns {Promise<string|null>} URL de firma o null si el on-premise no está disponible.
 */
async function generarUrlFirma(token, idTransaccion, tipoIdentificacion, identificacion) {
  const signioApiUrl = getSignioApiUrl();

  console.log('=== Intentando generar URL de firma on-premise ===');
  console.log('ID Transacción:', idTransaccion);
  console.log('Tipo ID:', tipoIdentificacion);
  console.log('Documento:', identificacion);

  const requestBody = {
    transaction_id: idTransaccion,
    document_type: tipoIdentificacion,
    document: identificacion,
    direct_signature: 1,
    op_token: 'SCREEN'
  };

  const endpoint = `${signioApiUrl}/envelope/onpremise/get-signed-url`;
  console.log('Endpoint:', endpoint);

  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Response status:', response.status);

    if (response.status === 404) {
      console.log('Endpoint on-premise no disponible en este ambiente. Firma por EMAIL.');
      return null;
    }

    const responseText = await response.text();

    if (responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')) {
      console.log('Respuesta HTML inesperada — endpoint no disponible.');
      return null;
    }

    const data = JSON.parse(responseText);

    if (data.url) return data.url;
    if (data.signed_url) return data.signed_url;
    if (data.data?.url) return data.data.url;
    if (data.link) return data.link;

    console.log('Respuesta sin URL:', JSON.stringify(data));
    return null;

  } catch (error) {
    console.log('Error al generar URL on-premise:', error.message);
    return null;
  }
}

/**
 * Recupera el estado actual de una transacción de Signio.
 * @param {string} token - Token Bearer.
 * @param {string} idTransaccion
 * @returns {Promise<Object>} Datos de la transacción desde Signio.
 * @throws {Error} Si la API retorna un código distinto de cero.
 */
async function obtenerTransaccion(token, idTransaccion) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/gestionar?id_transaccion=${idTransaccion}`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const data = await response.json();
  if (data.codigo !== '00') {
    throw new Error(`Error al obtener transacción: ${data.mensaje}`);
  }
  return data;
}

/**
 * Constantes de posición de firma predefinidas para páginas A4 (595 × 842 pt).
 * El origen del eje Y está en la parte inferior de la página (sistema de coordenadas PDF).
 */
export const POSICIONES_FIRMA = {
  ABAJO_IZQUIERDA: { pagina: 1, x: 50, y: 80, ancho: 150, alto: 50 },
  ABAJO_CENTRO: { pagina: 1, x: 220, y: 80, ancho: 150, alto: 50 },
  ABAJO_DERECHA: { pagina: 1, x: 400, y: 80, ancho: 150, alto: 50 },
  MEDIO_IZQUIERDA: { pagina: 1, x: 50, y: 400, ancho: 150, alto: 50 },
  MEDIO_CENTRO: { pagina: 1, x: 220, y: 400, ancho: 150, alto: 50 },
  MEDIO_DERECHA: { pagina: 1, x: 400, y: 400, ancho: 150, alto: 50 },
  ULTIMA_PAGINA_IZQUIERDA: (numPaginas) => ({ pagina: numPaginas, x: 50, y: 80, ancho: 150, alto: 50 }),
  ULTIMA_PAGINA_DERECHA: (numPaginas) => ({ pagina: numPaginas, x: 400, y: 80, ancho: 150, alto: 50 }),
};

/**
 * Orquesta el flujo completo de firma en Signio: crea una transacción, carga el PDF,
 * registra y vincula todos los firmantes, distribuye el sobre e intenta obtener una
 * URL de firma on-premise para el firmante principal.
 *
 * @param {Object} params
 * @param {string} params.nombre_documento - Nombre visible del documento.
 * @param {string} [params.external_id] - ID de referencia local; por defecto `doc_<timestamp>`.
 * @param {Buffer|string} params.pdf - PDF como Buffer o cadena base64.
 * @param {string} [params.nombre_archivo] - Nombre del archivo PDF; por defecto `documento.pdf`.
 * @param {{ nombre: string, tipo_identificacion?: string, identificacion: string, email: string, celular?: string, rol?: string, posicion_firma?: object }} params.firmante_principal
 * @param {Array<{ nombre: string, identificacion: string, email: string, posicion_firma?: object }>} [params.firmantes_externos=[]]
 * @returns {Promise<{ success: boolean, id_transaccion?: string, url_firma?: string|null, firma_por_email?: boolean, mensaje?: string, error?: string }>}
 */
export async function enviarDocumentoAFirmar({
  nombre_documento,
  external_id,
  pdf,
  nombre_archivo,
  firmante_principal,
  firmantes_externos = []
}) {
  try {
    const token = await getSignioToken();

    const idTransaccion = await crearTransaccion(
      token,
      nombre_documento,
      external_id || `doc_${Date.now()}`
    );

    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'base64');

    let numPaginas = 1;
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      numPaginas = pdfDoc.getPageCount();
      console.log(`PDF tiene ${numPaginas} página(s)`);
    } catch (pdfErr) {
      console.log('No se pudo leer el PDF para contar páginas, usando página 1');
    }

    const idDocumento = await cargarDocumento(
      token,
      idTransaccion,
      pdfBuffer,
      nombre_archivo || 'documento.pdf'
    );

    const idFirmantePrincipal = await registrarFirmante(token, idTransaccion, firmante_principal, 1);

    const posicionPrincipal = firmante_principal.posicion_firma ||
      { pagina: numPaginas, x: 50, y: 80, ancho: 150, alto: 50 };
    await vincularFirmanteDocumento(token, idTransaccion, idFirmantePrincipal, idDocumento, posicionPrincipal);

    const posicionesExternas = [
      { pagina: numPaginas, x: 400, y: 80, ancho: 150, alto: 50 },
      { pagina: numPaginas, x: 220, y: 80, ancho: 150, alto: 50 },
      { pagina: numPaginas, x: 50, y: 160, ancho: 150, alto: 50 },
      { pagina: numPaginas, x: 400, y: 160, ancho: 150, alto: 50 }
    ];

    for (let i = 0; i < firmantes_externos.length; i++) {
      const firmante = firmantes_externos[i];
      const idFirmante = await registrarFirmante(token, idTransaccion, firmante, i + 2);
      const posicionFirmante = firmante.posicion_firma || posicionesExternas[i] || posicionesExternas[0];
      await vincularFirmanteDocumento(token, idTransaccion, idFirmante, idDocumento, posicionFirmante);
    }

    await distribuirTransaccion(token, idTransaccion);

    const urlFirma = await generarUrlFirma(
      token,
      idTransaccion,
      firmante_principal.tipo_identificacion || 'CC',
      firmante_principal.identificacion
    );

    const mensaje = urlFirma
      ? 'Documento listo para firma. Use la URL proporcionada.'
      : 'Documento enviado a firma. Todos los firmantes recibirán un email con el enlace para firmar.';

    return {
      success: true,
      id_transaccion: idTransaccion,
      url_firma: urlFirma,
      firma_por_email: !urlFirma,
      mensaje
    };

  } catch (error) {
    console.error('Error en enviarDocumentoAFirmar:', error);
    return { success: false, error: error.message };
  }
}

/**
 * POST /signio/enviar-firma
 * Crea una transacción completa de firma en Signio a partir de un PDF codificado en base64.
 *
 * @body {{
 *   nombre_documento: string,
 *   external_id?: string,
 *   pdf_base64: string,
 *   nombre_archivo?: string,
 *   firmante_principal: { nombre: string, tipo_identificacion?: string, identificacion: string, email: string, celular?: string, rol?: string },
 *   firmantes_externos?: Array<{ nombre: string, identificacion: string, email: string, celular?: string, rol?: string }>
 * }}
 * @returns {{ success: boolean, id_transaccion: string, url_firma: string|null, mensaje: string }}
 */
router.post('/enviar-firma', async (req, res) => {
  try {
    const {
      nombre_documento,
      external_id,
      pdf_base64,
      nombre_archivo,
      firmante_principal,
      firmantes_externos = []
    } = req.body;

    if (!nombre_documento || !pdf_base64 || !firmante_principal) {
      return res.status(400).json({
        error: 'Faltan campos requeridos: nombre_documento, pdf_base64, firmante_principal'
      });
    }

    if (!firmante_principal.nombre || !firmante_principal.identificacion || !firmante_principal.email) {
      return res.status(400).json({
        error: 'El firmante principal debe tener: nombre, identificacion, email'
      });
    }

    const token = await getSignioToken();
    const idTransaccion = await crearTransaccion(token, nombre_documento, external_id || `doc_${Date.now()}`);
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    const idDocumento = await cargarDocumento(token, idTransaccion, pdfBuffer, nombre_archivo || 'documento.pdf');

    const idFirmantePrincipal = await registrarFirmante(token, idTransaccion, firmante_principal, 1);
    await vincularFirmanteDocumento(token, idTransaccion, idFirmantePrincipal, idDocumento);

    for (let i = 0; i < firmantes_externos.length; i++) {
      const firmante = firmantes_externos[i];
      if (!firmante.nombre || !firmante.identificacion || !firmante.email) {
        return res.status(400).json({
          error: `Firmante externo ${i + 1} debe tener: nombre, identificacion, email`
        });
      }
      const idFirmante = await registrarFirmante(token, idTransaccion, firmante, i + 2);
      await vincularFirmanteDocumento(token, idTransaccion, idFirmante, idDocumento);
    }

    await distribuirTransaccion(token, idTransaccion);

    const urlFirma = await generarUrlFirma(
      token,
      idTransaccion,
      firmante_principal.tipo_identificacion || 'CC',
      firmante_principal.identificacion
    );

    res.json({
      success: true,
      id_transaccion: idTransaccion,
      url_firma: urlFirma,
      mensaje: 'Documento enviado a firma. Los firmantes externos recibirán un email.'
    });

  } catch (error) {
    console.error('Error en /signio/enviar-firma:', error);
    res.status(500).json({ error: 'Error al procesar la firma', detalle: error.message });
  }
});

/**
 * POST /signio/webhook
 * Recibe notificaciones de cambio de estado de Signio y hace upsert del registro en `signio_documentos`.
 * Siempre responde 200 para evitar reintentos de Signio, incluso ante errores internos.
 */
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    console.log('Webhook de Signio recibido:', JSON.stringify(payload, null, 2));

    const { id_transaccion, external_id, estado, documentos } = payload;

    if (global.db && id_transaccion) {
      await global.db.query(`
        CREATE TABLE IF NOT EXISTS signio_documentos (
          id SERIAL PRIMARY KEY,
          id_transaccion VARCHAR(100) UNIQUE NOT NULL,
          external_id VARCHAR(100),
          estado VARCHAR(50),
          documentos JSONB,
          fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await global.db.query(`
        INSERT INTO signio_documentos (id_transaccion, external_id, estado, documentos, fecha_actualizacion)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (id_transaccion)
        DO UPDATE SET estado = $3, documentos = $4, fecha_actualizacion = CURRENT_TIMESTAMP
      `, [id_transaccion, external_id, estado, JSON.stringify(documentos)]);

      console.log(`Documento ${id_transaccion} actualizado a estado: ${estado}`);
    }

    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Error en webhook de Signio:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * GET /signio/estado/:id_transaccion
 * Retorna el estado actual de una transacción de firma.
 * Consulta primero la BD local; si no hay datos, hace una llamada en vivo a la API de Signio.
 * @param {string} id_transaccion
 */
router.get('/estado/:id_transaccion', async (req, res) => {
  try {
    const { id_transaccion } = req.params;

    if (global.db) {
      const result = await global.db.query(
        'SELECT * FROM signio_documentos WHERE id_transaccion = $1',
        [id_transaccion]
      );
      if (result.rows.length > 0) {
        return res.json(result.rows[0]);
      }
    }

    const token = await getSignioToken();
    const transaccion = await obtenerTransaccion(token, id_transaccion);
    res.json(transaccion);

  } catch (error) {
    console.error('Error al consultar estado:', error);
    res.status(500).json({ error: 'Error al consultar estado', detalle: error.message });
  }
});

/**
 * GET /signio/documento/:id_transaccion
 * Retorna los enlaces de descarga del documento firmado para una transacción.
 * Consulta primero la BD local; si no hay datos, hace una llamada en vivo a la API de Signio.
 * @param {string} id_transaccion
 */
router.get('/documento/:id_transaccion', async (req, res) => {
  try {
    const { id_transaccion } = req.params;

    if (global.db) {
      const result = await global.db.query(
        'SELECT * FROM signio_documentos WHERE id_transaccion = $1',
        [id_transaccion]
      );
      if (result.rows.length > 0 && result.rows[0].documentos) {
        return res.json({
          id_transaccion,
          estado: result.rows[0].estado,
          documentos: result.rows[0].documentos
        });
      }
    }

    const token = await getSignioToken();
    const transaccion = await obtenerTransaccion(token, id_transaccion);
    res.json({ id_transaccion, estado: transaccion.estado, documentos: transaccion.documentos });

  } catch (error) {
    console.error('Error al obtener documento:', error);
    res.status(500).json({ error: 'Error al obtener documento', detalle: error.message });
  }
});

/**
 * GET /signio/listar
 * Lista las transacciones de Signio filtradas por estado.
 * @query {number} estado - 0: todas, 2: pendientes, 3: firmadas, 4: rechazadas.
 */
router.get('/listar', async (req, res) => {
  try {
    const { estado } = req.query;
    const token = await getSignioToken();

    const response = await fetch(`${getSignioApiUrl()}/transacciones/listar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ estado: parseInt(estado) || 0 })
    });

    const data = await response.json();
    if (data.codigo !== '00') {
      throw new Error(data.mensaje);
    }

    res.json({ transacciones: data.transacciones });

  } catch (error) {
    console.error('Error al listar transacciones:', error);
    res.status(500).json({ error: 'Error al listar transacciones', detalle: error.message });
  }
});

export default router;
