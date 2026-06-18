function sendError(res, error, fallbackMessage) {
  const status = Number(error?.status) || 500;
  if (status === 400 || status === 404 || status === 409) {
    return res.status(status).json({ error: error.message, code: error.code || undefined });
  }

  console.error(fallbackMessage, error);
  return res.status(500).json({ error: fallbackMessage });
}

function parseId(rawId) {
  const id = Number.parseInt(String(rawId || ""), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function createCampaignsController({ service }) {
  return {
    getActiveCampaign: async (_req, res) => {
      try {
        return res.json(await service.getActiveCampaign());
      } catch (error) {
        return sendError(res, error, "Error consultando campaña activa");
      }
    },

    listCampaigns: async (_req, res) => {
      try {
        return res.json(await service.listCampaigns());
      } catch (error) {
        return sendError(res, error, "Error consultando campañas");
      }
    },

    getCampaignById: async (req, res) => {
      try {
        const id = parseId(req.params.id);
        if (!id) throw Object.assign(new Error("id is required"), { status: 400 });
        return res.json(await service.getCampaignById(id));
      } catch (error) {
        return sendError(res, error, "Error consultando campaña");
      }
    },

    createCampaign: async (req, res) => {
      try {
        const result = await service.createCampaign({
          ...req.body,
          image: req.file || null
        });
        return res.status(201).json(result);
      } catch (error) {
        return sendError(res, error, "Error creando campaña");
      }
    },

    updateCampaign: async (req, res) => {
      try {
        const id = parseId(req.params.id);
        if (!id) throw Object.assign(new Error("id is required"), { status: 400 });
        const result = await service.updateCampaign(id, {
          ...req.body,
          image: req.file || null
        });
        return res.json(result);
      } catch (error) {
        return sendError(res, error, "Error actualizando campaña");
      }
    },

    patchCampaignStatus: async (req, res) => {
      try {
        const id = parseId(req.params.id);
        if (!id) throw Object.assign(new Error("id is required"), { status: 400 });
        const result = await service.patchCampaignStatus(id, req.body);
        return res.json(result);
      } catch (error) {
        return sendError(res, error, "Error actualizando estado de campaña");
      }
    },

    archiveCampaign: async (req, res) => {
      try {
        const id = parseId(req.params.id);
        if (!id) throw Object.assign(new Error("id is required"), { status: 400 });
        const result = await service.archiveCampaign(id);
        return res.json(result);
      } catch (error) {
        return sendError(res, error, "Error archivando campaña");
      }
    }
  };
}

