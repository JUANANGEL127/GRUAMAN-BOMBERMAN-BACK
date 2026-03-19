import express from "express";
import bcrypt from "bcrypt";
const router = express.Router();

const SALT_ROUNDS = 10;

/**
 * Estado del limitador de tasa en memoria indexado por dirección IP.
 * Cada entrada: { count: number, resetAt: number (epoch ms) }
 * @type {Map<string, { count: number, resetAt: number }>}
 */
const pinLoginAttempts = new Map();

/**
 * Aplica un límite de tasa de ventana deslizante de 10 intentos por IP cada 15 minutos.
 * Escribe una respuesta 429 y retorna false si se supera el límite.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean} True si la solicitud está dentro del límite, false si fue bloqueada.
 */
function checkPinRateLimit(req, res) {
  const ipKey = req.ip;
  const now = Date.now();
  const attempt = pinLoginAttempts.get(ipKey) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (now > attempt.resetAt) {
    attempt.count = 0;
    attempt.resetAt = now + 15 * 60 * 1000;
  }
  if (attempt.count >= 10) {
    res.status(429).json({ error: 'Demasiados intentos. Espera 15 minutos.' });
    return false;
  }
  attempt.count++;
  pinLoginAttempts.set(ipKey, attempt);
  return true;
}

/**
 * GET /auth/pin/status
 * Retorna si un trabajador tiene la autenticación por PIN habilitada y si el PIN ha sido configurado.
 * @query {string} numero_identificacion
 * @returns {{ pinHabilitado: boolean, pinConfigurado: boolean }}
 */
router.get("/status", async (req, res) => {
  const { numero_identificacion } = req.query;
  if (!numero_identificacion) {
    return res.status(400).json({ error: "Falta numero_identificacion" });
  }
  try {
    const db = global.db;
    const q = await db.query(
      "SELECT pin_habilitado, pin_hash FROM trabajadores WHERE numero_identificacion = $1",
      [numero_identificacion]
    );
    if (q.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const { pin_habilitado, pin_hash } = q.rows[0];
    res.json({
      pinHabilitado: !!pin_habilitado,
      pinConfigurado: !!pin_hash
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/pin/set
 * Crea o actualiza el PIN del trabajador autenticado. Requiere `pin_habilitado = true`.
 * @body {{ numero_identificacion: string, pin: string }} El PIN debe ser numérico de 4 a 8 dígitos.
 * @returns {{ success: boolean }}
 * @throws {400} Si el formato del PIN es inválido.
 * @throws {403} Si la autenticación por PIN no está habilitada para el trabajador.
 * @throws {404} Si el trabajador no existe.
 */
router.post("/set", async (req, res) => {
  const { numero_identificacion, pin } = req.body;
  if (!numero_identificacion || !pin) {
    return res.status(400).json({ error: "Faltan datos" });
  }
  if (typeof pin !== "string" || pin.length < 4 || pin.length > 8 || !/^\d+$/.test(pin)) {
    return res.status(400).json({ error: "El PIN debe ser numérico de 4 a 8 dígitos" });
  }
  try {
    const db = global.db;
    const q = await db.query(
      "SELECT pin_habilitado FROM trabajadores WHERE numero_identificacion = $1",
      [numero_identificacion]
    );
    if (q.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    if (!q.rows[0].pin_habilitado) {
      return res.status(403).json({ error: "Este usuario no tiene PIN habilitado" });
    }
    const hash = await bcrypt.hash(pin, SALT_ROUNDS);
    await db.query(
      "UPDATE trabajadores SET pin_hash = $1 WHERE numero_identificacion = $2",
      [hash, numero_identificacion]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /auth/pin/verify
 * Valida el PIN de un trabajador. Sujeto a limitación de tasa por IP (10 intentos / 15 min).
 * Limpia el contador de límite de tasa al autenticarse exitosamente.
 * @body {{ numero_identificacion: string, pin: string }}
 * @returns {{ success: boolean }}
 * @throws {400} Si el PIN aún no ha sido configurado (`requiereCrearPin: true`).
 * @throws {401} Si el PIN es incorrecto.
 * @throws {403} Si la autenticación por PIN no está habilitada para el trabajador.
 * @throws {429} Si la IP ha superado el límite de tasa.
 */
router.post("/verify", async (req, res) => {
  const { numero_identificacion, pin } = req.body;
  if (!numero_identificacion || !pin) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  if (!checkPinRateLimit(req, res)) return;

  try {
    const db = global.db;
    const q = await db.query(
      "SELECT pin_habilitado, pin_hash FROM trabajadores WHERE numero_identificacion = $1",
      [numero_identificacion]
    );
    if (q.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const { pin_habilitado, pin_hash } = q.rows[0];
    if (!pin_habilitado) {
      return res.status(403).json({ error: "Este usuario no tiene PIN habilitado" });
    }
    if (!pin_hash) {
      return res.status(400).json({ error: "PIN no configurado", requiereCrearPin: true });
    }
    const match = await bcrypt.compare(pin, pin_hash);
    if (!match) {
      return res.status(401).json({ success: false, error: "PIN incorrecto" });
    }
    pinLoginAttempts.delete(req.ip);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
