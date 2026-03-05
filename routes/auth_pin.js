import express from "express";
import bcrypt from "bcrypt";
const router = express.Router();

const SALT_ROUNDS = 10;

// GET /auth/pin/status?numero_identificacion=xxx
// Devuelve si el usuario tiene PIN habilitado y si ya lo configuró
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

// POST /auth/pin/set
// El usuario crea o cambia su propio PIN (solo si pin_habilitado = true)
// Body: { numero_identificacion, pin }
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

// POST /auth/pin/verify
// Verifica el PIN del usuario para autenticación
// Body: { numero_identificacion, pin }
router.post("/verify", async (req, res) => {
  const { numero_identificacion, pin } = req.body;
  if (!numero_identificacion || !pin) {
    return res.status(400).json({ error: "Faltan datos" });
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
