import { DateTime } from "luxon";

const BOGOTA_TIMEZONE = "America/Bogota";
const CANONICAL_TEMPORAL_TYPES = new Set([
  "vacaciones",
  "permiso",
  "sancion",
  "incapacidad_at",
  "incapacidad_general",
  "licencia"
]);

function createHttpError(status, message, code = null) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

function normalizeDateInput(input, fieldName) {
  const value = String(input || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw createHttpError(400, `Campo inválido: ${fieldName}`);
  }
  const parsed = DateTime.fromFormat(value, "yyyy-LL-dd", { zone: BOGOTA_TIMEZONE });
  if (!parsed.isValid) {
    throw createHttpError(400, `Campo inválido: ${fieldName}`);
  }
  return parsed.toFormat("yyyy-LL-dd");
}

function normalizeTemporalType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (CANONICAL_TEMPORAL_TYPES.has(normalized)) {
    return normalized;
  }
  throw createHttpError(400, "tipo debe ser uno de los tipos canonicos de novedad temporal");
}

function normalizeRemunerada(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw createHttpError(400, "remunerada debe ser booleano");
}

function resolveDefaultRemuneradaForType(tipo, motiveCatalogRepository) {
  if (tipo !== "permiso" && tipo !== "licencia") {
    return false;
  }

  if (motiveCatalogRepository?.findDefaultTemporalMotiveByTipo) {
    return motiveCatalogRepository.findDefaultTemporalMotiveByTipo(tipo);
  }

  return Promise.resolve(null);
}

function normalizeMotivo(value) {
  const motivo = String(value || "").trim();
  if (!motivo) {
    throw createHttpError(400, "motivo es obligatorio");
  }
  return motivo;
}

function normalizeMotiveId(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createHttpError(400, "motivo_id debe ser un entero positivo");
  }
  return parsed;
}

function todayBogota() {
  return DateTime.now().setZone(BOGOTA_TIMEZONE).toFormat("yyyy-LL-dd");
}

function buildTemporalSummary({ current = null, next = null, history = [] }) {
  return {
    vigente_hoy: Boolean(current),
    excluye_indicador_central: Boolean(current),
    estado_actual: current,
    estado_programado: next,
    historial: history
  };
}

export function createWorkerTemporalStateService({ repository, motiveCatalogRepository = null }) {

  async function assertWorkerExists(workerId) {
    const worker = await repository.findWorkerById(workerId);
    if (!worker) {
      throw createHttpError(404, "Trabajador no encontrado");
    }
    return worker;
  }

  async function assertNoTemporalOverlap({ workerId, fechaInicio, fechaFin, excludeId = null }) {
    const hasOverlap = await repository.hasOverlappingTemporalState({
      workerId,
      fechaInicio,
      fechaFin,
      excludeId
    });
    if (hasOverlap) {
      throw createHttpError(409, "Ya existe un estado temporal que se superpone con el rango enviado");
    }
  }

  async function normalizeCreatePayload(rawPayload = {}) {
    const tipo = normalizeTemporalType(rawPayload.tipo);
    const motivoId = normalizeMotiveId(rawPayload.motivo_id);
    const motivo = rawPayload.motivo !== undefined ? normalizeMotivo(rawPayload.motivo) : null;
    const remunerada = rawPayload.remunerada === undefined ? undefined : normalizeRemunerada(rawPayload.remunerada);
    const fechaInicio = normalizeDateInput(rawPayload.fecha_inicio, "fecha_inicio");
    const fechaFin = normalizeDateInput(rawPayload.fecha_fin, "fecha_fin");

    let motiveCatalogEntry = null;
    if (motivoId !== null) {
      if (!motiveCatalogRepository) {
        throw createHttpError(500, "Repositorio de motivos no disponible");
      }

      motiveCatalogEntry = await motiveCatalogRepository.findActiveTemporalMotiveById(motivoId);
      if (!motiveCatalogEntry) {
        const inactiveEntry = await motiveCatalogRepository.findTemporalMotiveById(motivoId);
        if (inactiveEntry) {
          throw createHttpError(409, "El motivo catalogado no está activo");
        }
        throw createHttpError(404, "Motivo temporal no encontrado");
      }

      if (motiveCatalogEntry.tipo !== tipo) {
        throw createHttpError(400, "El motivo catalogado no coincide con el tipo temporal");
      }
    }

    if (!motiveCatalogEntry && !motivo) {
      throw createHttpError(400, "motivo es obligatorio");
    }

    const defaultTypeEntry = remunerada === undefined && !motiveCatalogEntry
      ? await resolveDefaultRemuneradaForType(tipo, motiveCatalogRepository)
      : null;
    const effectiveRemunerada = remunerada !== undefined
      ? remunerada
      : motiveCatalogEntry
        ? motiveCatalogEntry.remunerada_default
        : defaultTypeEntry?.remunerada_default ?? false;

    if (fechaFin < fechaInicio) {
      throw createHttpError(400, "fecha_fin debe ser mayor o igual que fecha_inicio");
    }

    return {
      tipo,
      motivo,
      motivoId,
      motivoLabel: motiveCatalogEntry ? motiveCatalogEntry.nombre : motivo,
      remunerada: effectiveRemunerada,
      motiveCatalogEntry,
      fechaInicio,
      fechaFin
    };
  }

  async function normalizeUpdatePayload(rawPayload = {}, currentRecord) {
    const updates = {};

    if (rawPayload.tipo !== undefined) {
      updates.tipo = normalizeTemporalType(rawPayload.tipo);
    }
    if (rawPayload.motivo !== undefined) {
      updates.motivo = normalizeMotivo(rawPayload.motivo);
    }
    if (rawPayload.remunerada !== undefined) {
      updates.remunerada = normalizeRemunerada(rawPayload.remunerada);
    }
    if (rawPayload.fecha_inicio !== undefined) {
      updates.fechaInicio = normalizeDateInput(rawPayload.fecha_inicio, "fecha_inicio");
    }
    if (rawPayload.fecha_fin !== undefined) {
      updates.fechaFin = normalizeDateInput(rawPayload.fecha_fin, "fecha_fin");
    }

    if (Object.keys(updates).length === 0) {
      throw createHttpError(400, "Debes enviar al menos un campo para actualizar");
    }

    const fechaInicio = updates.fechaInicio ?? currentRecord.fecha_inicio;
    const fechaFin = updates.fechaFin ?? currentRecord.fecha_fin;
    if (fechaFin && fechaInicio && fechaFin < fechaInicio) {
      throw createHttpError(400, "fecha_fin debe ser mayor o igual que fecha_inicio");
    }

    return updates;
  }

  return {
    async getWorkerTemporalState(workerId, cutoffDate = todayBogota()) {
      const worker = await assertWorkerExists(workerId);
      const [current, next, history] = await Promise.all([
        repository.findCurrentTemporalStateByWorkerIdAtCutoff
          ? repository.findCurrentTemporalStateByWorkerIdAtCutoff(workerId, cutoffDate)
          : repository.findCurrentTemporalStateByWorkerId(workerId),
        repository.findNextTemporalStateByWorkerIdAtCutoff
          ? repository.findNextTemporalStateByWorkerIdAtCutoff(workerId, cutoffDate)
          : repository.findNextTemporalStateByWorkerId
            ? repository.findNextTemporalStateByWorkerId(workerId, cutoffDate)
            : null,
        repository.listTemporalStatesByWorkerIdHistory
          ? repository.listTemporalStatesByWorkerIdHistory(workerId)
          : repository.listTemporalStatesByWorkerId
            ? repository.listTemporalStatesByWorkerId(workerId)
          : repository.listTemporalStatesByWorkerIdAtCutoff
            ? repository.listTemporalStatesByWorkerIdAtCutoff(workerId, cutoffDate)
            : []
      ]);

      return {
        trabajador: worker,
        ...buildTemporalSummary({ current, next, history })
      };
    },

    async listTemporalStatesForWorkers(workerIds = [], cutoffDate = todayBogota()) {
      if (repository.findCurrentTemporalStatesByWorkerIdsAtCutoff) {
        return repository.findCurrentTemporalStatesByWorkerIdsAtCutoff(workerIds, cutoffDate);
      }
      return repository.findCurrentTemporalStatesByWorkerIds(workerIds);
    },

    async createTemporalState(workerId, rawPayload = {}, createdBy = null) {
      await assertWorkerExists(workerId);
      const payload = await normalizeCreatePayload(rawPayload);
      await assertNoTemporalOverlap({
        workerId,
        fechaInicio: payload.fechaInicio,
        fechaFin: payload.fechaFin
      });

      const created = await repository.createTemporalState({
        workerId,
        createdBy,
        tipo: payload.tipo,
        motivo: payload.motivoLabel,
        motivoId: payload.motiveCatalogEntry ? payload.motiveCatalogEntry.id : null,
        motivoCodigoSnapshot: payload.motiveCatalogEntry ? payload.motiveCatalogEntry.codigo : null,
        motivoNombreSnapshot: payload.motiveCatalogEntry ? payload.motiveCatalogEntry.nombre : null,
        motivoTipoSnapshot: payload.motiveCatalogEntry ? payload.motiveCatalogEntry.tipo : null,
        motivoRemuneradaSnapshot: payload.motiveCatalogEntry ? payload.motiveCatalogEntry.remunerada_default : null,
        remunerada: payload.remunerada,
        fechaInicio: payload.fechaInicio,
        fechaFin: payload.fechaFin
      });

      return created;
    },

    async anularTemporalState(workerId, recordId, rawPayload = {}, cancelledBy = null) {
      await assertWorkerExists(workerId);
      const currentRecord = await repository.findTemporalStateById(recordId);
      if (!currentRecord || Number(currentRecord.trabajador_id) !== Number(workerId)) {
        throw createHttpError(404, "Estado temporal no encontrado");
      }

      if (currentRecord.anulado_at) {
        throw createHttpError(409, "El estado temporal ya fue anulado");
      }

      const anuladoMotivo = String(rawPayload?.motivo_anulacion || rawPayload?.anulado_motivo || "").trim() || "Anulado";
      const anuladoAt = todayBogota();

      return repository.anularTemporalState(recordId, {
        anuladoAt,
        anuladoBy: cancelledBy,
        anuladoMotivo
      });
    },

    async updateTemporalState(workerId, recordId, rawPayload = {}) {
      await assertWorkerExists(workerId);
      const currentRecord = await repository.findTemporalStateById(recordId);
      if (!currentRecord || Number(currentRecord.trabajador_id) !== Number(workerId)) {
        throw createHttpError(404, "Estado temporal no encontrado");
      }

      if (currentRecord.cerrado_at) {
        throw createHttpError(409, "No podés modificar un estado temporal ya cerrado");
      }

      const updates = await normalizeUpdatePayload(rawPayload, currentRecord);
      const fechaInicio = updates.fechaInicio ?? currentRecord.fecha_inicio;
      const fechaFin = updates.fechaFin ?? currentRecord.fecha_fin;

      await assertNoTemporalOverlap({
        workerId,
        fechaInicio,
        fechaFin,
        excludeId: recordId
      });

      const updated = await repository.updateTemporalState(recordId, {
        tipo: updates.tipo,
        motivo: updates.motivo,
        remunerada: updates.remunerada,
        fechaInicio: updates.fechaInicio,
        fechaFin: updates.fechaFin
      });

      return updated;
    },

    async closeTemporalState(workerId, recordId, rawPayload = {}, closedBy = null) {
      await assertWorkerExists(workerId);
      const currentRecord = await repository.findTemporalStateById(recordId);
      if (!currentRecord || Number(currentRecord.trabajador_id) !== Number(workerId)) {
        throw createHttpError(404, "Estado temporal no encontrado");
      }

      if (currentRecord.cerrado_at) {
        throw createHttpError(409, "El estado temporal ya fue cerrado");
      }

      const cerradoAt = new Date().toISOString();
      return repository.closeTemporalState(recordId, { cerradoAt, cerradoBy: closedBy });
    }
  };
}
