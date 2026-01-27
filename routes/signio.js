import express from 'express';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { PDFDocument } from 'pdf-lib';

const router = express.Router();

// Cache del token (expira en 2 horas)
let tokenCache = {
  token: null,
  expiresAt: null
};

/**
 * Helper para obtener la URL de Signio en tiempo de ejecución
 */
function getSignioApiUrl() {
  return process.env.SIGNIO_API_URL || 'https://signio.stage.legops.com/api/v2';
}

/**
 * Genera u obtiene un token de autenticación de Signio
 */
async function getSignioToken() {
  // Si el token está en cache y no ha expirado, usarlo
  if (tokenCache.token && tokenCache.expiresAt && new Date() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  // Leer credenciales en tiempo de ejecución (no al cargar el módulo)
  const signioEmail = process.env.SIGNIO_EMAIL;
  const signioPassword = process.env.SIGNIO_PASSWORD;
  const signioApiUrl = getSignioApiUrl();

  // Debug: verificar credenciales
  console.log('Signio Auth - Email:', signioEmail);
  console.log('Signio Auth - Password:', signioPassword ? '***SET***' : 'NOT SET');
  console.log('Signio Auth - URL:', `${signioApiUrl}/token/crear`);

  const response = await fetch(`${signioApiUrl}/token/crear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: signioEmail,
      password: signioPassword
    })
  });

  const data = await response.json();
  console.log('Signio Auth - Response:', JSON.stringify(data));
  
  if (data.codigo !== '00') {
    throw new Error(`Error al obtener token de Signio: ${data.mensaje}`);
  }

  // Guardar en cache (expira en 1 hora 50 minutos para tener margen)
  tokenCache.token = data.token;
  tokenCache.expiresAt = new Date(Date.now() + 110 * 60 * 1000);

  return data.token;
}

/**
 * Crea una transacción (sobre) en Signio
 */
async function crearTransaccion(token, nombre, externalId) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/crear`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      nombre: nombre,
      external_id: externalId,
      op_token: 'SCREEN',        // Código en pantalla (más rápido)
      op_foto: 'NO',             // No pide foto
      op_btnRechazo: 0,          // Sin botón de rechazo
      on_premise_signature: 1    // Permite firma en sitio
    })
  });

  const data = await response.json();
  
  if (data.codigo !== '00') {
    throw new Error(`Error al crear transacción: ${data.mensaje}`);
  }

  return data.id_transaccion;
}

/**
 * Carga un documento PDF a la transacción
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
 * Registra un firmante en la transacción
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
      orden: orden,
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
 * Vincula un firmante a un documento
 */
async function vincularFirmanteDocumento(token, idTransaccion, idFirmante, idDocumento, posicion = null) {
  const body = {
    id_transaccion: idTransaccion,
    id_firmante: idFirmante,
    id_documento: idDocumento
  };

  // Si se proporciona posición, agregarla
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
 * Distribuye la transacción (envía emails a firmantes externos)
 */
async function distribuirTransaccion(token, idTransaccion) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/distribuir`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      id_transaccion: idTransaccion
    })
  });

  const data = await response.json();
  
  if (data.codigo !== '00') {
    throw new Error(`Error al distribuir transacción: ${data.mensaje}`);
  }

  return true;
}

/**
 * Genera URL firmada para proceso de firma en sitio (on-premise)
 * Según documentación Signio 6.24: PUT envelope/onpremise/get-signed-url
 * 
 * NOTA: Este endpoint puede no estar disponible en todos los ambientes/cuentas.
 * Si no está disponible, se retorna null y el flujo continúa por email.
 */
async function generarUrlFirma(token, idTransaccion, tipoIdentificacion, identificacion) {
  const signioApiUrl = getSignioApiUrl();
  
  console.log('=== Intentando generar URL de firma on-premise ===');
  console.log('ID Transacción:', idTransaccion);
  console.log('Tipo ID:', tipoIdentificacion);
  console.log('Documento:', identificacion);
  
  // Según documentación oficial de Signio (6.24)
  const requestBody = {
    transaction_id: idTransaccion,
    document_type: tipoIdentificacion,  // Ej: CC
    document: identificacion,            // Número de identificación
    direct_signature: 1,                 // 1 = Direcciona directo al proceso de firma
    op_token: 'SCREEN'                   // SCREEN = token en pantalla
  };
  
  const endpoint = `${signioApiUrl}/envelope/onpremise/get-signed-url`;
  console.log('Endpoint:', endpoint);
  
  try {
    const response = await fetch(endpoint, {
      method: 'PUT',  // Según documentación oficial es PUT
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    console.log('Response status:', response.status);
    
    // Si es 404, el endpoint no existe en este ambiente
    if (response.status === 404) {
      console.log('⚠️ Endpoint on-premise no disponible en este ambiente.');
      console.log('Los firmantes recibirán el link de firma por EMAIL.');
      return null;  // Retornar null para indicar que no hay URL on-premise
    }
    
    const responseText = await response.text();
    
    // Si es HTML, error de servidor
    if (responseText.startsWith('<!DOCTYPE') || responseText.startsWith('<html')) {
      console.log('⚠️ Respuesta HTML - endpoint no disponible.');
      return null;
    }
    
    const data = JSON.parse(responseText);
    
    // Buscar URL en la respuesta
    if (data.url) {
      console.log('✅ URL de firma obtenida:', data.url);
      return data.url;
    }
    
    // Algunos APIs retornan en campos alternativos
    if (data.signed_url) return data.signed_url;
    if (data.data?.url) return data.data.url;
    if (data.link) return data.link;
    
    console.log('⚠️ Respuesta sin URL:', JSON.stringify(data));
    return null;
    
  } catch (error) {
    console.log('⚠️ Error al generar URL on-premise:', error.message);
    console.log('Los firmantes recibirán el link de firma por EMAIL.');
    return null;
  }
}

/**
 * Obtiene información de una transacción
 */
async function obtenerTransaccion(token, idTransaccion) {
  const response = await fetch(`${getSignioApiUrl()}/transacciones/gestionar?id_transaccion=${idTransaccion}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  
  if (data.codigo !== '00') {
    throw new Error(`Error al obtener transacción: ${data.mensaje}`);
  }

  return data;
}

// ============================================
// ENDPOINTS
// ============================================

/**
 * POST /signio/enviar-firma
 * 
 * Crea una transacción completa y devuelve el link de firma para el operario
 * 
 * Body esperado:
 * {
 *   nombre_documento: "Permiso de Trabajo - 2026-01-26",
 *   external_id: "permiso_trabajo_123",
 *   pdf_base64: "JVBERi0xLjQK...",    // PDF en base64
 *   nombre_archivo: "permiso_trabajo.pdf",
 *   firmante_principal: {
 *     nombre: "Juan Pérez",
 *     tipo_identificacion: "CC",
 *     identificacion: "123456789",
 *     email: "juan@email.com",
 *     celular: "573001234567",
 *     rol: "operario"
 *   },
 *   firmantes_externos: [
 *     {
 *       nombre: "Carlos Rodríguez",
 *       tipo_identificacion: "CC",
 *       identificacion: "987654321",
 *       email: "carlos@obra.com",
 *       celular: "573009876543",
 *       rol: "jefe_obra"
 *     }
 *   ]
 * }
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

    // Validaciones
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

    // 1. Obtener token
    const token = await getSignioToken();

    // 2. Crear transacción
    const idTransaccion = await crearTransaccion(
      token,
      nombre_documento,
      external_id || `doc_${Date.now()}`
    );

    // 3. Cargar documento PDF
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    const idDocumento = await cargarDocumento(
      token,
      idTransaccion,
      pdfBuffer,
      nombre_archivo || 'documento.pdf'
    );

    // 4. Registrar firmante principal (orden 1)
    const idFirmantePrincipal = await registrarFirmante(
      token,
      idTransaccion,
      firmante_principal,
      1
    );

    // 5. Vincular firmante principal al documento
    await vincularFirmanteDocumento(token, idTransaccion, idFirmantePrincipal, idDocumento);

    // 6. Registrar y vincular firmantes externos
    for (let i = 0; i < firmantes_externos.length; i++) {
      const firmante = firmantes_externos[i];
      
      if (!firmante.nombre || !firmante.identificacion || !firmante.email) {
        return res.status(400).json({
          error: `Firmante externo ${i + 1} debe tener: nombre, identificacion, email`
        });
      }

      const idFirmante = await registrarFirmante(
        token,
        idTransaccion,
        firmante,
        i + 2 // Orden 2, 3, 4...
      );

      await vincularFirmanteDocumento(token, idTransaccion, idFirmante, idDocumento);
    }

    // 7. Distribuir transacción (envía emails a externos)
    await distribuirTransaccion(token, idTransaccion);

    // 8. Generar URL de firma para el firmante principal
    const urlFirma = await generarUrlFirma(
      token,
      idTransaccion,
      firmante_principal.tipo_identificacion || 'CC',
      firmante_principal.identificacion
    );

    // Respuesta exitosa
    res.json({
      success: true,
      id_transaccion: idTransaccion,
      url_firma: urlFirma,
      mensaje: 'Documento enviado a firma. Los firmantes externos recibirán un email.'
    });

  } catch (error) {
    console.error('Error en /signio/enviar-firma:', error);
    res.status(500).json({
      error: 'Error al procesar la firma',
      detalle: error.message
    });
  }
});

/**
 * POST /signio/webhook
 * 
 * Recibe notificaciones de Signio cuando un documento cambia de estado
 */
router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    
    console.log('Webhook de Signio recibido:', JSON.stringify(payload, null, 2));

    const { id_transaccion, external_id, estado, documentos } = payload;

    // Guardar en base de datos el estado del documento
    if (global.db && id_transaccion) {
      // Crear tabla si no existe
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

      // Insertar o actualizar
      await global.db.query(`
        INSERT INTO signio_documentos (id_transaccion, external_id, estado, documentos, fecha_actualizacion)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (id_transaccion) 
        DO UPDATE SET estado = $3, documentos = $4, fecha_actualizacion = CURRENT_TIMESTAMP
      `, [id_transaccion, external_id, estado, JSON.stringify(documentos)]);

      console.log(`Documento ${id_transaccion} actualizado a estado: ${estado}`);
    }

    // Responder 200 OK para confirmar recepción
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Error en webhook de Signio:', error);
    // Aún así responder 200 para que Signio no reintente
    res.status(200).json({ received: true, error: error.message });
  }
});

/**
 * GET /signio/estado/:id_transaccion
 * 
 * Consulta el estado de una transacción
 */
router.get('/estado/:id_transaccion', async (req, res) => {
  try {
    const { id_transaccion } = req.params;

    // Primero buscar en nuestra base de datos
    if (global.db) {
      const result = await global.db.query(
        'SELECT * FROM signio_documentos WHERE id_transaccion = $1',
        [id_transaccion]
      );

      if (result.rows.length > 0) {
        return res.json(result.rows[0]);
      }
    }

    // Si no está en BD, consultar a Signio directamente
    const token = await getSignioToken();
    const transaccion = await obtenerTransaccion(token, id_transaccion);

    res.json(transaccion);

  } catch (error) {
    console.error('Error al consultar estado:', error);
    res.status(500).json({
      error: 'Error al consultar estado',
      detalle: error.message
    });
  }
});

/**
 * GET /signio/documento/:id_transaccion
 * 
 * Obtiene los links de descarga de los documentos firmados
 */
router.get('/documento/:id_transaccion', async (req, res) => {
  try {
    const { id_transaccion } = req.params;

    // Buscar en base de datos
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

    // Si no está, consultar a Signio
    const token = await getSignioToken();
    const transaccion = await obtenerTransaccion(token, id_transaccion);

    res.json({
      id_transaccion,
      estado: transaccion.estado,
      documentos: transaccion.documentos
    });

  } catch (error) {
    console.error('Error al obtener documento:', error);
    res.status(500).json({
      error: 'Error al obtener documento',
      detalle: error.message
    });
  }
});

/**
 * GET /signio/listar
 * 
 * Lista las transacciones por estado
 */
router.get('/listar', async (req, res) => {
  try {
    const { estado } = req.query; // 0: Todos, 2: Pendientes, 3: Firmados, 4: Rechazados

    const token = await getSignioToken();

    const response = await fetch(`${getSignioApiUrl()}/transacciones/listar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        estado: parseInt(estado) || 0
      })
    });

    const data = await response.json();

    if (data.codigo !== '00') {
      throw new Error(data.mensaje);
    }

    res.json({
      transacciones: data.transacciones
    });

  } catch (error) {
    console.error('Error al listar transacciones:', error);
    res.status(500).json({
      error: 'Error al listar transacciones',
      detalle: error.message
    });
  }
});

/**
 * Posiciones de firma predefinidas para página A4 (595 x 842 puntos)
 * Coordenadas X van de izquierda a derecha (0 a 595)
 * Coordenadas Y van de ABAJO hacia ARRIBA (0 es el fondo de la página)
 */
export const POSICIONES_FIRMA = {
  // Firmas en la parte inferior de la página
  ABAJO_IZQUIERDA: { pagina: 1, x: 50, y: 80, ancho: 150, alto: 50 },
  ABAJO_CENTRO: { pagina: 1, x: 220, y: 80, ancho: 150, alto: 50 },
  ABAJO_DERECHA: { pagina: 1, x: 400, y: 80, ancho: 150, alto: 50 },
  
  // Firmas en el medio de la página
  MEDIO_IZQUIERDA: { pagina: 1, x: 50, y: 400, ancho: 150, alto: 50 },
  MEDIO_CENTRO: { pagina: 1, x: 220, y: 400, ancho: 150, alto: 50 },
  MEDIO_DERECHA: { pagina: 1, x: 400, y: 400, ancho: 150, alto: 50 },
  
  // Para documentos de varias páginas (última página)
  ULTIMA_PAGINA_IZQUIERDA: (numPaginas) => ({ pagina: numPaginas, x: 50, y: 80, ancho: 150, alto: 50 }),
  ULTIMA_PAGINA_DERECHA: (numPaginas) => ({ pagina: numPaginas, x: 400, y: 80, ancho: 150, alto: 50 }),
};

/**
 * Función helper para enviar un documento a firmar desde otros routes
 * 
 * @param {Object} params
 * @param {string} params.nombre_documento - Nombre del documento
 * @param {string} params.external_id - ID interno para identificar el documento
 * @param {Buffer|string} params.pdf - PDF como Buffer o base64
 * @param {string} params.nombre_archivo - Nombre del archivo PDF
 * @param {Object} params.firmante_principal - Datos del firmante principal
 * @param {Object} params.firmante_principal.posicion_firma - Posición de firma (opcional) { pagina, x, y, ancho, alto }
 * @param {Array} params.firmantes_externos - Array de firmantes externos (cada uno puede tener posicion_firma)
 * 
 * @returns {Object} { success, id_transaccion, url_firma, mensaje }
 * 
 * @example
 * // Ejemplo con posiciones de firma
 * await enviarDocumentoAFirmar({
 *   nombre_documento: "Checklist",
 *   pdf: pdfBuffer,
 *   firmante_principal: {
 *     nombre: "Juan",
 *     identificacion: "123",
 *     email: "juan@test.com",
 *     posicion_firma: { pagina: 1, x: 50, y: 80, ancho: 150, alto: 50 }
 *   },
 *   firmantes_externos: [{
 *     nombre: "Pedro",
 *     identificacion: "456",
 *     email: "pedro@test.com",
 *     posicion_firma: POSICIONES_FIRMA.ABAJO_DERECHA
 *   }]
 * });
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
    // 1. Obtener token
    const token = await getSignioToken();

    // 2. Crear transacción
    const idTransaccion = await crearTransaccion(
      token,
      nombre_documento,
      external_id || `doc_${Date.now()}`
    );

    // 3. Preparar PDF (si viene en base64, convertir a Buffer)
    const pdfBuffer = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf, 'base64');
    
    // 3.1 Detectar número de páginas del PDF
    let numPaginas = 1;
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      numPaginas = pdfDoc.getPageCount();
      console.log(`PDF tiene ${numPaginas} página(s)`);
    } catch (pdfErr) {
      console.log('No se pudo leer el PDF para contar páginas, usando página 1');
    }
    
    // 4. Cargar documento PDF
    const idDocumento = await cargarDocumento(
      token,
      idTransaccion,
      pdfBuffer,
      nombre_archivo || 'documento.pdf'
    );

    // 5. Registrar firmante principal (orden 1)
    const idFirmantePrincipal = await registrarFirmante(
      token,
      idTransaccion,
      firmante_principal,
      1
    );

    // 6. Vincular firmante principal al documento (última página, abajo izquierda)
    const posicionPrincipal = firmante_principal.posicion_firma || 
      { pagina: numPaginas, x: 50, y: 80, ancho: 150, alto: 50 }; // Última página, abajo izquierda
    await vincularFirmanteDocumento(token, idTransaccion, idFirmantePrincipal, idDocumento, posicionPrincipal);

    // 7. Registrar y vincular firmantes externos
    for (let i = 0; i < firmantes_externos.length; i++) {
      const firmante = firmantes_externos[i];
      
      const idFirmante = await registrarFirmante(
        token,
        idTransaccion,
        firmante,
        i + 2 // Orden 2, 3, 4...
      );

      // Posiciones en la última página: derecha para el primero, centro para el segundo
      const posicionesExternas = [
        { pagina: numPaginas, x: 400, y: 80, ancho: 150, alto: 50 },  // Última página, abajo derecha
        { pagina: numPaginas, x: 220, y: 80, ancho: 150, alto: 50 },  // Última página, abajo centro
        { pagina: numPaginas, x: 50, y: 160, ancho: 150, alto: 50 },  // Última página, arriba izquierda
        { pagina: numPaginas, x: 400, y: 160, ancho: 150, alto: 50 }  // Última página, arriba derecha
      ];
      const posicionFirmante = firmante.posicion_firma || posicionesExternas[i] || posicionesExternas[0];
      
      await vincularFirmanteDocumento(token, idTransaccion, idFirmante, idDocumento, posicionFirmante);
    }

    // 8. Distribuir transacción (envía emails a externos)
    await distribuirTransaccion(token, idTransaccion);

    // 9. Intentar generar URL de firma on-premise para el firmante principal
    // Si no está disponible, los firmantes recibirán email con el link
    const urlFirma = await generarUrlFirma(
      token,
      idTransaccion,
      firmante_principal.tipo_identificacion || 'CC',
      firmante_principal.identificacion
    );

    // Mensaje según si hay URL on-premise o no
    const mensaje = urlFirma 
      ? 'Documento listo para firma. Use la URL proporcionada.'
      : 'Documento enviado a firma. Todos los firmantes recibirán un email con el enlace para firmar.';

    return {
      success: true,
      id_transaccion: idTransaccion,
      url_firma: urlFirma,  // Puede ser null si on-premise no está disponible
      firma_por_email: !urlFirma,  // Indicador de que la firma será por email
      mensaje: mensaje
    };

  } catch (error) {
    console.error('Error en enviarDocumentoAFirmar:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

export default router;
