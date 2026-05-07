import express from "express";
import base64url from "base64url";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from "@simplewebauthn/server";
import { writeAuthCookies } from "../helpers/authCookies.js";
import { requireWorkerSelfOrAdmin } from "../middlewares/requireWorkerSelfOrAdmin.js";
const router = express.Router();
let authSessionService = null;
let authConfig = null;
let authenticateSession = null;
let csrfProtection = null;

export function configureWebAuthnSession(dependencies) {
  authSessionService = dependencies.authSessionService;
  authConfig = dependencies.authConfig;
  authenticateSession = dependencies.authenticateSession;
  csrfProtection = dependencies.csrfProtection;
}

function requireConfiguredSession(req, res, next) {
  if (!authenticateSession) {
    return res.status(500).json({ success: false, error: "Authentication is not configured" });
  }
  return authenticateSession(req, res, next);
}

function requireConfiguredCsrf(req, res, next) {
  if (!csrfProtection) {
    return next();
  }
  return csrfProtection(req, res, next);
}

const requireWebAuthnOwnerOrAdmin = requireWorkerSelfOrAdmin((req) => req.body?.numero_identificacion);

/**
 * Convierte una cadena base64 estándar a formato base64url (RFC 4648 §5).
 * @param {string} str
 * @returns {string}
 */
function ensureBase64url(str) {
  if (!str) return str;
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Flexible(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) {
    return value;
  }
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sanitizeWebAuthnCredentialResponse(response) {
  if (!response) return response;
  return {
    ...response,
    id: ensureBase64url(response.id),
    rawId: ensureBase64url(response.rawId),
    response: {
      ...response.response,
      clientDataJSON: ensureBase64url(response.response?.clientDataJSON),
      authenticatorData: ensureBase64url(response.response?.authenticatorData),
      signature: ensureBase64url(response.response?.signature),
      userHandle: ensureBase64url(response.response?.userHandle),
      attestationObject: ensureBase64url(response.response?.attestationObject)
    }
  };
}

function getWebAuthnConfig() {
  return {
    rpID: process.env.WEBAUTHN_RPID,
    rpName: process.env.WEBAUTHN_RPNAME,
    origin: process.env.WEBAUTHN_ORIGIN
  };
}

function isWebAuthnDebugEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.AUTH_DEBUG_REQUESTS || "").toLowerCase()
  );
}

function debugWebAuthn(message, metadata = {}) {
  if (!isWebAuthnDebugEnabled()) return;
  console.info("[WebAuthn][debug]", { message, ...metadata });
}

function logWebAuthnError(message, err) {
  console.error("[WebAuthn]", {
    message,
    errorName: err?.name || "Error",
    errorMessage: err?.message || "Unexpected WebAuthn error"
  });
}

/**
 * Almacén en memoria de challenges indexado por `numero_identificacion`.
 * Cada entrada: { challenge: string, createdAt: number }
 *
 * NOTA: Este Map se limpia al reiniciar el servidor (ej. arranques en frío de Render free-tier),
 * lo que invalida cualquier ceremonia WebAuthn en curso. La solución definitiva es
 * persistir los challenges en la base de datos.
 * @type {Map<string, Array<{ challenge: string, createdAt: number }>>}
 */
const challengeMap = new Map();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_CHALLENGES_PER_USER = 5;

function addChallenge(numero_identificacion, challenge) {
  const now = Date.now();
  const previous = challengeMap.get(numero_identificacion) || [];
  const next = [{ challenge, createdAt: now }, ...previous]
    .filter((entry) => now - entry.createdAt <= CHALLENGE_TTL_MS)
    .slice(0, MAX_CHALLENGES_PER_USER);
  challengeMap.set(numero_identificacion, next);
}

function getExpectedChallenge(numero_identificacion, clientChallenge) {
  const now = Date.now();
  const entries = challengeMap.get(numero_identificacion) || [];
  const fresh = entries.filter((entry) => now - entry.createdAt <= CHALLENGE_TTL_MS);
  if (fresh.length !== entries.length) {
    if (fresh.length > 0) challengeMap.set(numero_identificacion, fresh);
    else challengeMap.delete(numero_identificacion);
  }
  const match = fresh.find((entry) => entry.challenge === clientChallenge);
  return match ? match.challenge : null;
}

function consumeChallenge(numero_identificacion, challenge) {
  const entries = challengeMap.get(numero_identificacion) || [];
  const next = entries.filter((entry) => entry.challenge !== challenge);
  if (next.length > 0) challengeMap.set(numero_identificacion, next);
  else challengeMap.delete(numero_identificacion);
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, entries] of challengeMap.entries()) {
    const fresh = (entries || []).filter((entry) => now - entry.createdAt <= CHALLENGE_TTL_MS);
    if (fresh.length > 0) challengeMap.set(userId, fresh);
    else challengeMap.delete(userId);
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

async function getWorkerAuthCandidate(numero_identificacion, db) {
  const result = await db.query(
    `SELECT
       t.id,
       t.numero_identificacion,
       t.nombre,
       t.empresa_id,
       COALESCE(NULLIF(t.empresa, ''), e.nombre) AS empresa_slug,
       t.obra_id,
       t.cargo,
       t.activo
     FROM trabajadores t
     LEFT JOIN empresas e ON e.id = t.empresa_id
     WHERE t.numero_identificacion = $1`,
    [numero_identificacion]
  );
  return result.rows[0] || null;
}

function sendInactiveWorkerLogin(res) {
  return res.status(403).json({
    success: false,
    authenticated: false,
    activo: false,
    error: "Usuario inactivo"
  });
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
  const worker = await getWorkerAuthCandidate(numero_identificacion, db);
  if (!worker) {
    return res.json({ hasCredential: false, activo: false });
  }
  if (worker.activo === false) {
    return res.json({ hasCredential: false, activo: false });
  }
  const q = await db.query(
    'SELECT credential_id FROM webauthn_credenciales WHERE numero_identificacion = $1',
    [numero_identificacion]
  );
  return res.json({ hasCredential: q.rows.length > 0, activo: true });
});

/**
 * POST /webauthn/register/options
 * Genera las opciones de registro WebAuthn para una nueva ceremonia de passkey.
 * Excluye las credenciales ya registradas para evitar duplicados.
 * @body {{ numero_identificacion: string, nombre: string }}
 * @returns {PublicKeyCredentialCreationOptions}
 */
router.post("/register/options", async (req, res) => {
  const { numero_identificacion } = req.body;
  if (!numero_identificacion) {
    return res.status(400).json({ error: "Falta numero_identificacion" });
  }
  const db = global.db;
  const worker = await getWorkerAuthCandidate(numero_identificacion, db);
  if (!worker) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  if (worker.activo === false) {
    return sendInactiveWorkerLogin(res);
  }
  let credenciales;
  try {
    credenciales = await getCredenciales(numero_identificacion, db);
    debugWebAuthn("registration options credential count loaded", {
      credentialCount: credenciales.length
    });
  } catch (err) {
    logWebAuthnError("error loading credentials for registration options", err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  let registrationOptions;
  try {
    const { rpID, rpName } = getWebAuthnConfig();
    registrationOptions = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(numero_identificacion, 'utf8'),
      userName: worker.nombre || numero_identificacion,
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
    debugWebAuthn("registration options generated", {
      excludeCredentialCount: credenciales.length
    });
  } catch (err) {
    logWebAuthnError("error generating registration options", err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  addChallenge(numero_identificacion, registrationOptions.challenge);
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
  if (!numero_identificacion || !attestationResponse) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const sanitizedResponse = sanitizeWebAuthnCredentialResponse(attestationResponse);

  const db = global.db;
  const clientChallenge = sanitizedResponse?.response?.clientDataJSON
    ? JSON.parse(Buffer.from(sanitizedResponse.response.clientDataJSON, "base64url").toString("utf8"))?.challenge
    : undefined;
  const expectedChallenge = clientChallenge
    ? getExpectedChallenge(numero_identificacion, clientChallenge)
    : null;
  if (!expectedChallenge) {
    return res.status(400).json({ error: "No hay challenge para este usuario" });
  }
  let verification;
  try {
    const { rpID, origin } = getWebAuthnConfig();
    verification = await verifyRegistrationResponse({
      response: sanitizedResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID
    });
  } catch (err) {
    logWebAuthnError("registration verification failed", err);
    return res.status(400).json({ error: "Verificación fallida" });
  }
  if (!verification.verified) {
    return res.status(400).json({ error: "Registro no verificado" });
  }
  debugWebAuthn("registration verification completed", { verified: true });
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
  } catch (err) {
    logWebAuthnError("error storing registration credential", err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  consumeChallenge(numero_identificacion, expectedChallenge);
  debugWebAuthn("registration credential stored");
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
  const worker = await getWorkerAuthCandidate(numero_identificacion, db);
  if (!worker) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  if (worker.activo === false) {
    return sendInactiveWorkerLogin(res);
  }
  const credenciales = await getCredenciales(numero_identificacion, db);
  debugWebAuthn("authentication options credential count loaded", {
    credentialCount: credenciales.length
  });
  if (!credenciales.length) {
    return res.status(404).json({
      error: "No hay credenciales para este usuario",
      mensaje: "Este dispositivo no tiene llaves de acceso registradas. Por favor, registre primero una llave de acceso.",
      requiereRegistro: true
    });
  }
  let authenticationOptions;
  try {
    const { rpID } = getWebAuthnConfig();
    authenticationOptions = await generateAuthenticationOptions({
      rpID,
      userVerification: "preferred",
      allowCredentials: credenciales.map(c => ({
        id: c.credential_id,
        type: "public-key",
        transports: ["internal", "hybrid", "usb", "ble", "nfc"]
      }))
    });
    debugWebAuthn("authentication options generated", {
      allowCredentialCount: credenciales.length
    });
  } catch (err) {
    logWebAuthnError("error generating authentication options", err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
  addChallenge(numero_identificacion, authenticationOptions.challenge);
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
  const sanitizedAssertionResponse = sanitizeWebAuthnCredentialResponse(assertionResponse);
  const db = global.db;
  const worker = await getWorkerAuthCandidate(numero_identificacion, db);
  if (!worker) {
    return res.status(404).json({ error: "Usuario no encontrado" });
  }
  if (worker.activo === false) {
    return sendInactiveWorkerLogin(res);
  }
  const credenciales = await getCredenciales(numero_identificacion, db);
  if (!credenciales.length) {
    return res.status(404).json({ error: "No hay credenciales para este usuario" });
  }
  const clientChallenge = sanitizedAssertionResponse?.response?.clientDataJSON
    ? JSON.parse(Buffer.from(sanitizedAssertionResponse.response.clientDataJSON, "base64url").toString("utf8"))?.challenge
    : undefined;
  const expectedChallenge = clientChallenge
    ? getExpectedChallenge(numero_identificacion, clientChallenge)
    : null;
  if (!expectedChallenge) {
    return res.status(400).json({ error: "No hay challenge para este usuario" });
  }
  const credential = credenciales.find(c => sanitizedAssertionResponse.id === c.credential_id);
  if (!credential) {
    return res.status(404).json({ error: "Credencial no encontrada" });
  }
  let verification;
  try {
    const { rpID, origin } = getWebAuthnConfig();
    verification = await verifyAuthenticationResponse({
      response: sanitizedAssertionResponse,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: credential.credential_id,
        publicKey: decodeBase64Flexible(credential.public_key),
        counter: credential.sign_count,
        transports: ["internal"]
      }
    });
  } catch (err) {
    logWebAuthnError("authentication verification failed", err);
    return res.status(400).json({ error: "Verificación fallida" });
  }
  if (!verification.verified) {
    return res.status(400).json({ error: "Autenticación no verificada" });
  }
  await db.query(
    "UPDATE webauthn_credenciales SET sign_count = $1 WHERE credential_id = $2",
    [verification.authenticationInfo.newCounter, credential.credential_id]
  );
  if (!authSessionService || !authConfig) {
    return res.status(500).json({ success: false, error: "Autenticación no configurada" });
  }
  const sessionResult = await authSessionService.issueWorkerSession({
    worker,
    request: req
  });
  writeAuthCookies(res, authConfig, sessionResult);
  consumeChallenge(numero_identificacion, expectedChallenge);
  res.json({
    success: true,
    authenticated: true,
    user: sessionResult.user,
    session: sessionResult.session
  });
});

export default router;
