import { Router } from 'express';
import {
  getActiveIndicadorCentralConfig,
  runIndicadorCentralCutoff,
  saveIndicadorCentralConfig,
  normalizeIndicadorCentralConfig,
} from '../../helpers/indicador_central.js';

const router = Router();

router.use((req, res, next) => {
  if (!global.db) {
    return res.status(503).json({ error: 'Base de datos no inicializada. Intenta nuevamente en unos segundos.' });
  }
  next();
});

/**
 * GET /administrador/indicador_central/configuracion
 * Retorna la configuraci�n activa del indicador central.
 */
router.get('/configuracion', async (_req, res) => {
  try {
    const config = await getActiveIndicadorCentralConfig(global.db);
    if (!config) {
      return res.status(404).json({ success: false, error: 'No existe configuraci�n activa para el indicador central' });
    }
    return res.json({ success: true, configuracion: config });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /administrador/indicador_central/configuracion
 * Crea una nueva versi�n activa de configuraci�n para el indicador central.
 */
router.put('/configuracion', async (req, res) => {
  try {
    const current = (await getActiveIndicadorCentralConfig(global.db)) || normalizeIndicadorCentralConfig({});
    const umbralesPayload = (req.body?.umbrales && typeof req.body.umbrales === 'object' && !Array.isArray(req.body.umbrales))
      ? req.body.umbrales
      : {};
    const scopePayload = (req.body?.scope && typeof req.body.scope === 'object' && !Array.isArray(req.body.scope))
      ? req.body.scope
      : {};

    const payload = {
      ...current,
      ...req.body,
      umbrales: {
        ...(current.umbrales || {}),
        ...umbralesPayload
      },
      scope: {
        ...(current.scope || {}),
        ...scopePayload
      }
    };

    const saved = await saveIndicadorCentralConfig(payload, {
      db: global.db,
      updatedBy: req.body?.updated_by || 'admin'
    });

    return res.json({ success: true, configuracion: saved });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * POST /administrador/indicador_central/ejecutar
 * Ejecuta manualmente un corte del indicador central.
 */
router.post('/ejecutar', async (req, res) => {
  try {
    const { fecha_corte, corte_tipo = 'diario', omitir_envio = false } = req.body || {};
    const result = await runIndicadorCentralCutoff({
      fechaCorte: fecha_corte,
      corteTipo: corte_tipo,
      origen: 'manual',
      canal: 'email',
      omitirEnvio: omitir_envio === true,
      db: global.db
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
