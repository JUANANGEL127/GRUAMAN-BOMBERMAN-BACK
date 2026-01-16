import express from "express";
import util from "util";
import base64url from "base64url";
const router = express.Router();

// Función para asegurar que un string esté en formato base64url
function ensureBase64url(str) {
  if (!str) return str;
  // Reemplazar caracteres base64 estándar por base64url y eliminar padding
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Verifica si el usuario tiene credencial biométrica registrada
router.post('/hasCredential', async (req, res) => {
  const { numero_identificacion } = req.body;
  if (!numero_identificacion) {
    return res.status(400).json({ error: 'Falta numero_identificacion' });
  }
  const db = global.db;
  const q = await db.query(
    'SELECT credential_id FROM webauthn_credenciales WHERE numero_identificacion = $1',
    [numero_identificacion]
  );
  if (q.rows.length > 0) {
    return res.json({ hasCredential: true });
  } else {
    return res.json({ hasCredential: false });
  }
});

// Utilidad para obtener credenciales de la base de datos
async function getCredenciales(numero_identificacion, db) {
  const q = await db.query(
    "SELECT * FROM webauthn_credenciales WHERE numero_identificacion = $1",
    [numero_identificacion]
  );
  return q.rows;
}
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from "@simplewebauthn/server";

// Configuración WebAuthn
const rpID = process.env.WEBAUTHN_RPID;
const rpName = process.env.WEBAUTHN_RPNAME;
const origin = process.env.WEBAUTHN_ORIGIN;

// Almacenamiento temporal de challenge por usuario
const challengeMap = new Map();

// 1. Generar opciones de registro
router.post("/register/options", async (req, res) => {
  const { numero_identificacion, nombre } = req.body;
  console.log('[WebAuthn] /register/options body:', req.body);
  if (!numero_identificacion || !nombre) {
    console.log('[WebAuthn] /register/options error: Faltan datos');
    return res.status(400).json({ error: "Faltan datos" });
  }
  const db = global.db;
  let credenciales;
  try {
    credenciales = await getCredenciales(numero_identificacion, db);
    console.log('[WebAuthn] Credenciales encontradas:', credenciales.length);
  } catch (err) {
    console.error('[WebAuthn] Error obteniendo credenciales:', err);
    return res.status(500).json({ error: 'Error obteniendo credenciales', detalle: err.message });
  }
  let registrationOptions;
  try {
    registrationOptions = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(numero_identificacion, 'utf8'),
      userName: nombre,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred"
        // Removido authenticatorAttachment: "platform" para permitir
        // llaves de seguridad externas y autenticación cross-device
      },
      excludeCredentials: credenciales.map(c => ({
        id: c.credential_id, // Ya es base64url string en v13+
        type: "public-key"
      }))
    });
    // Para ver todas las propiedades, usar util.inspect
   
    console.log('[WebAuthn] registrationOptions generadas:', util.inspect(registrationOptions, { depth: null, colors: true }));
  } catch (err) {
    console.error('[WebAuthn] Error generando registrationOptions:', err);
    return res.status(500).json({ error: 'Error generando registrationOptions', detalle: err.message });
  }
  challengeMap.set(numero_identificacion, registrationOptions.challenge);
  res.json(registrationOptions);
});

// 2. Verificar registro y guardar credencial
router.post("/register/verify", async (req, res) => {
  const { numero_identificacion, attestationResponse } = req.body;
  console.log('[WebAuthn] /register/verify body:', req.body);
  if (!numero_identificacion || !attestationResponse) {
    console.log('[WebAuthn] /register/verify error: Faltan datos');
    return res.status(400).json({ error: "Faltan datos" });
  }
  
  // Asegurar que los IDs estén en formato base64url
  const sanitizedResponse = {
    ...attestationResponse,
    id: ensureBase64url(attestationResponse.id),
    rawId: ensureBase64url(attestationResponse.rawId)
  };
  console.log('[WebAuthn] sanitizedResponse:', sanitizedResponse);
  
  const db = global.db;
  const expectedChallenge = challengeMap.get(numero_identificacion);
  if (!expectedChallenge) {
    console.log('[WebAuthn] /register/verify error: No hay challenge para este usuario');
    return res.status(400).json({ error: "No hay challenge para este usuario" });
  }
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: sanitizedResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID
    });
    console.log('[WebAuthn] Resultado de verificación:', verification);
  } catch (err) {
    console.error('[WebAuthn] Error en verifyRegistrationResponse:', err);
    return res.status(400).json({ error: "Verificación fallida", detalle: err.message });
  }
  if (!verification.verified) {
    console.log('[WebAuthn] Registro no verificado:', verification);
    return res.status(400).json({ error: "Registro no verificado" });
  }
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  const { id: credentialID, publicKey: credentialPublicKey, counter } = credential;
  try {
    await db.query(
      `INSERT INTO webauthn_credenciales (numero_identificacion, credential_id, public_key, sign_count, tipo_autenticador)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        numero_identificacion,
        credentialID, // Ya viene como base64url string en v13+
        Buffer.from(credentialPublicKey).toString("base64"),
        counter,
        credentialDeviceType || null
      ]
    );
    console.log('[WebAuthn] Credencial guardada en la base de datos');
  } catch (err) {
    console.error('[WebAuthn] Error guardando credencial en la base de datos:', err);
    return res.status(500).json({ error: 'Error guardando credencial', detalle: err.message });
  }
  challengeMap.delete(numero_identificacion);
  res.json({ success: true });
});

// 3. Generar opciones de autenticación
router.post("/authenticate/options", async (req, res) => {
  const { numero_identificacion } = req.body;
  if (!numero_identificacion) {
    return res.status(400).json({ error: "Falta numero_identificacion" });
  }
  const db = global.db;
  const credenciales = await getCredenciales(numero_identificacion, db);
  console.log('[WebAuthn] /authenticate/options - credenciales encontradas:', credenciales.length);
  if (!credenciales.length) {
    return res.status(404).json({ 
      error: "No hay credenciales para este usuario",
      mensaje: "Este dispositivo no tiene llaves de acceso registradas. Por favor, registre primero una llave de acceso.",
      requiereRegistro: true
    });
  }
  const authenticationOptions = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: credenciales.map(c => ({
      id: c.credential_id, // Ya es base64url string
      type: "public-key",
      transports: ["internal", "hybrid", "usb", "ble", "nfc"] // Permitir todos los transportes
    }))
  });
  console.log('[WebAuthn] authenticationOptions generadas:', util.inspect(authenticationOptions, { depth: null, colors: true }));
  challengeMap.set(numero_identificacion, authenticationOptions.challenge);
  res.json(authenticationOptions);
});

// 4. Verificar autenticación
router.post("/authenticate/verify", async (req, res) => {
  const { numero_identificacion, assertionResponse } = req.body;
  if (!numero_identificacion || !assertionResponse) {
    return res.status(400).json({ error: "Faltan datos" });
  }
  const db = global.db;
  const credenciales = await getCredenciales(numero_identificacion, db);
  if (!credenciales.length) {
    return res.status(404).json({ error: "No hay credenciales para este usuario" });
  }
  const expectedChallenge = challengeMap.get(numero_identificacion);
  if (!expectedChallenge) {
    return res.status(400).json({ error: "No hay challenge para este usuario" });
  }
  // Busca la credencial por credential_id
  const credential = credenciales.find(c => assertionResponse.id === c.credential_id);
  if (!credential) {
    return res.status(404).json({ error: "Credencial no encontrada" });
  }
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertionResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credential_id, // Ya es base64url string
        publicKey: Buffer.from(credential.public_key, "base64"),
        counter: credential.sign_count,
        transports: ["internal"]
      }
    });
  } catch (err) {
    return res.status(400).json({ error: "Verificación fallida", detalle: err.message });
  }
  if (!verification.verified) {
    return res.status(400).json({ error: "Autenticación no verificada" });
  }
  // Actualiza el contador
  await db.query(
    "UPDATE webauthn_credenciales SET sign_count = $1 WHERE credential_id = $2",
    [verification.authenticationInfo.newCounter, credential.credential_id]
  );
  challengeMap.delete(numero_identificacion);
  res.json({ success: true });
});

export default router;
