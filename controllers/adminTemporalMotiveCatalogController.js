function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const message = error?.message || "Error interno";

  if (status === 400 || status === 404 || status === 409) {
    return res.status(status).json({ success: false, error: message });
  }

  return res.status(500).json({ success: false, error: "Error interno procesando motivos temporales" });
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createAdminTemporalMotiveCatalogController({ service }) {
  return {
    async listTemporalMotives(req, res) {
      try {
        const motives = await service.listTemporalMotives();
        return res.json({ success: true, motivos: motives });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async createTemporalMotive(req, res) {
      try {
        const created = await service.createTemporalMotive(req.body);
        return res.status(201).json({ success: true, motivo: created });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async updateTemporalMotive(req, res) {
      try {
        const motiveId = parsePositiveInteger(req.params.motiveId);
        if (!motiveId) {
          return res.status(400).json({ success: false, error: "motiveId debe ser un entero positivo" });
        }
        const updated = await service.updateTemporalMotive(motiveId, req.body);
        return res.json({ success: true, motivo: updated });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async activateTemporalMotive(req, res) {
      try {
        const motiveId = parsePositiveInteger(req.params.motiveId);
        if (!motiveId) {
          return res.status(400).json({ success: false, error: "motiveId debe ser un entero positivo" });
        }
        const updated = await service.activateTemporalMotive(motiveId);
        return res.json({ success: true, motivo: updated });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async deactivateTemporalMotive(req, res) {
      try {
        const motiveId = parsePositiveInteger(req.params.motiveId);
        if (!motiveId) {
          return res.status(400).json({ success: false, error: "motiveId debe ser un entero positivo" });
        }
        const updated = await service.deactivateTemporalMotive(motiveId);
        return res.json({ success: true, motivo: updated });
      } catch (error) {
        return sendError(res, error);
      }
    }
  };
}
