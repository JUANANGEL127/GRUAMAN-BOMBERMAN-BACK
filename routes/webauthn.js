import express from "express";
import util from "util";
import base64url from "base64url";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from "@simplewebauthn/server";
const router = express.Router();

/**
 * Convierte una cadena base64 estándar a formato base64url (RFC 4648 §5).
 * @param {string} str
 * @returns {string}
 */
function ensureBase64url(str) {
  if (!str) return str;
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const rpID = process.env.WEBAUTHN_RPID;
const rpName = process.env.WEBAUTHN_RPNAME;
const origin = process.env.WEBAUTHN_ORIGIN;

/**
 * Almacén en memoria de challenges indexado por `numero_identificacion`.
 * Cada entrada: { challenge: string, createdAt: number }
 *
 * NOTA: Este Map se limpia al reiniciar el servidor (ej. arranques en frío de Render free-tier),
 * lo que invalida cualquier ceremonia WebAuthn en curso. La solución definitiva es
 * persistir los challenges en la base de datos.
 * @type {Map<string, { challenge: string, createdAt: number }>}
 */
const challengeMap = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [userId, data] of challengeMap.entries()) {
    if (now - data.createdAt > 5 * 60 * 1000) {
      challengeMap.delete(userId);
    }
  }
}, 10 * 60 * 1000);

/**
 * Recupera todas las credenciales WebAuthn almacenadas para un trabajador.
 * @param {string} numero_identificacion
 * @param {import('pg').Pool} db
 * @returns {Promise<Array>} Filas de credenciales de `webauthn_credenciales`.
 */
async function getCredenciales(numero_identificacion, db) {
  const q = await db.query(
    "SELECT * FROM webauthn_credenciales WHERE numero_identificacion = $1",
    [numero_identificacion]
  );
  return q.rows;
}

/**
 * POST /webauthn/hasCredential
 * Verifica si un trabajador tiene al menos una llave de acceso (passkey) registrada.
 * @body {{ numero_identificacion: string }}
 * @returns {{ hasCredential: boolean }}
 */
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
  return res.json({ hasCredential: q.rows.length > 0 });
});

/**
 * POST /webauthn/register/options
 * Genera las opciones de registro WebAuthn para una nueva ceremonia de passkey.
 * Excluye las credenciales ya registradas para evitar duplicados.
 * @body {{ numero_identificacion: string, nombre: string }}
 * @returns {PublicKeyCredentialCreationOptions}
 */
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
      },
      excludeCredentials: credenciales.map(c => ({
        id: c.credential_id,
        type: "public-key"
      }))
    });
    console.log('[WebAuthn] registrationOptions generadas:', util.inspect(registrationOptions, { depth: null, colors: true }));
  } catch (err) {
    console.error('[WebAuthn] Error generando registrationOptions:', err);
    return res.status(500).json({ error: 'Error generando registrationOptions', detalle: err.message });
  }
  challengeMap.set(numero_identificacion, { challenge: registrationOptions.challenge, createdAt: Date.now() });
  res.json(registrationOptions);
});

/**
 * POST /webauthn/register/verify
 * Verifica la respuesta de attestation y persiste la nueva credencial.
 * @body {{ numero_identificacion: string, attestationResponse: object }}
 * @returns {{ success: boolean }}
 * @throws {400} Si el challenge no existe o la verificación falla.
 */
router.post("/register/verify", async (req, res) => {
  const { numero_identificacion, attestationResponse } = req.body;
  console.log('[WebAuthn] /register/verify body:', req.body);
  if (!numero_identificacion || !attestationResponse) {
    console.log('[WebAuthn] /register/verify error: Faltan datos');
    return res.status(400).json({ error: "Faltan datos" });
  }

  const sanitizedResponse = {
    ...attestationResponse,
    id: ensureBase64url(attestationResponse.id),
    rawId: ensureBase64url(attestationResponse.rawId)
  };
  console.log('[WebAuthn] sanitizedResponse:', sanitizedResponse);

  const db = global.db;
  const challengeEntry = challengeMap.get(numero_identificacion);
  const expectedChallenge = challengeEntry ? challengeEntry.challenge : undefined;
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
  const { credential, credentialDeviceType } = verification.registrationInfo;
  const { id: credentialID, publicKey: credentialPublicKey, counter } = credential;
  try {
    await db.query(
      `INSERT INTO webauthn_credenciales (numero_identificacion, credential_id, public_key, sign_count, tipo_autenticador)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        numero_identificacion,
        credentialID,
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

/**
 * POST /webauthn/authenticate/options
 * Genera las opciones de autenticación WebAuthn para una ceremonia de passkey existente.
 * @body {{ numero_identificacion: string }}
 * @returns {PublicKeyCredentialRequestOptions}
 * @throws {404} Si no hay credenciales registradas para el trabajador.
 */
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
      id: c.credential_id,
      type: "public-key",
      transports: ["internal", "hybrid", "usb", "ble", "nfc"]
    }))
  });
  console.log('[WebAuthn] authenticationOptions generadas:', util.inspect(authenticationOptions, { depth: null, colors: true }));
  challengeMap.set(numero_identificacion, { challenge: authenticationOptions.challenge, createdAt: Date.now() });
  res.json(authenticationOptions);
});

/**
 * POST /webauthn/authenticate/verify
 * Verifica la respuesta de assertion y actualiza el contador de firmas de la credencial.
 * @body {{ numero_identificacion: string, assertionResponse: object }}
 * @returns {{ success: boolean }}
 * @throws {400} Si el challenge no existe o la verificación falla.
 * @throws {404} Si la credencial referenciada en la assertion no se encuentra.
 */
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
  const authChallengeEntry = challengeMap.get(numero_identificacion);
  const expectedChallenge = authChallengeEntry ? authChallengeEntry.challenge : undefined;
  if (!expectedChallenge) {
    return res.status(400).json({ error: "No hay challenge para este usuario" });
  }
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
        id: credential.credential_id,
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
  await db.query(
    "UPDATE webauthn_credenciales SET sign_count = $1 WHERE credential_id = $2",
    [verification.authenticationInfo.newCounter, credential.credential_id]
  );
  challengeMap.delete(numero_identificacion);
  res.json({ success: true });
});

export default router;
