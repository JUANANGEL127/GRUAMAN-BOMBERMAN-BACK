function sendError(res, error) {
  const status = Number(error?.status) || 500;
  const message = error?.message || "Error interno";

  if (status === 400 || status === 404 || status === 409) {
    return res.status(status).json({ success: false, error: message });
  }

  if (error?.code === '23P01') {
    console.error("[adminWorkerTemporalStateController]", {
      status,
      message,
      code: error?.code || null,
      stack: error?.stack || null
    });
    return res.status(409).json({
      success: false,
      error: "Ya existe un estado temporal que se superpone con el rango enviado"
    });
  }

  console.error("[adminWorkerTemporalStateController]", {
    status,
    message,
    code: error?.code || null,
    stack: error?.stack || null
  });

  return res.status(500).json({ success: false, error: "Error interno procesando estado temporal del trabajador" });
}

function parsePositiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function mapTemporalDetailResponse(payload) {
  return {
    success: true,
    trabajador: {
      id: payload.trabajador.id,
      nombre: payload.trabajador.nombre,
      activo: payload.trabajador.activo,
      empresa_id: payload.trabajador.empresa_id,
      numero_identificacion: payload.trabajador.numero_identificacion
    },
    estado_temporal_actual: payload.estado_actual,
    estado_temporal_programado: payload.estado_programado,
    historial_estados_temporales: payload.historial,
    vigente_hoy: payload.vigente_hoy,
    excluye_indicador_central: payload.excluye_indicador_central
  };
}

export function createAdminWorkerTemporalStateController({ service }) {
  return {
    async getTemporalState(req, res) {
      try {
        const workerId = parsePositiveInteger(req.params.id);
        if (!workerId) {
          return res.status(400).json({ success: false, error: "id debe ser un entero positivo" });
        }
        const result = await service.getWorkerTemporalState(workerId);
        return res.json(mapTemporalDetailResponse(result));
      } catch (error) {
        return sendError(res, error);
      }
    },

    async createTemporalState(req, res) {
      try {
        const workerId = parsePositiveInteger(req.params.id);
        if (!workerId) {
          return res.status(400).json({ success: false, error: "id debe ser un entero positivo" });
        }
        const created = await service.createTemporalState(workerId, req.body, req.auth?.user?.adminId || req.auth?.user?.id || null);
        return res.status(201).json({ success: true, estado_temporal: created });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async updateTemporalState(req, res) {
      try {
        const workerId = parsePositiveInteger(req.params.id);
        const recordId = parsePositiveInteger(req.params.estadoTemporalId);
        if (!workerId || !recordId) {
          return res.status(400).json({ success: false, error: "id y estadoTemporalId deben ser enteros positivos" });
        }
        const updated = await service.updateTemporalState(workerId, recordId, req.body);
        return res.json({ success: true, estado_temporal: updated });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async closeTemporalState(req, res) {
      try {
        const workerId = parsePositiveInteger(req.params.id);
        const recordId = parsePositiveInteger(req.params.estadoTemporalId);
        if (!workerId || !recordId) {
          return res.status(400).json({ success: false, error: "id y estadoTemporalId deben ser enteros positivos" });
        }
        const closedBy = req.auth?.user?.adminId || req.auth?.user?.id || null;
        const closed = await service.closeTemporalState(workerId, recordId, req.body, closedBy);
        return res.json({ success: true, estado_temporal: closed });
      } catch (error) {
        return sendError(res, error);
      }
    },

    async anularTemporalState(req, res) {
      try {
        const workerId = parsePositiveInteger(req.params.id);
        const recordId = parsePositiveInteger(req.params.estadoTemporalId);
        if (!workerId || !recordId) {
          return res.status(400).json({ success: false, error: "id y estadoTemporalId deben ser enteros positivos" });
        }
        const cancelledBy = req.auth?.user?.adminId || req.auth?.user?.id || null;
        const cancelled = await service.anularTemporalState(workerId, recordId, req.body, cancelledBy);
        return res.json({ success: true, estado_temporal: cancelled });
      } catch (error) {
        return sendError(res, error);
      }
    }
  };
}
