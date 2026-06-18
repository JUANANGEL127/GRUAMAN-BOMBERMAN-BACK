const ALLOWED_TEMPORAL_TYPES = new Set([
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

function normalizeTemporalType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!ALLOWED_TEMPORAL_TYPES.has(normalized)) {
    throw createHttpError(400, "tipo debe ser uno de los tipos canonicos de novedad temporal");
  }
  return normalized;
}

function normalizeBoolean(value, fieldName) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw createHttpError(400, `${fieldName} debe ser booleano`);
}

function normalizePositiveInteger(value, fieldName) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createHttpError(400, `${fieldName} debe ser un entero válido`);
  }
  return parsed;
}

export function createTemporalMotiveCatalogService({ repository }) {
  return {
    async listTemporalMotives() {
      return repository.listTemporalMotives();
    },

    async createTemporalMotive(rawPayload = {}) {
      const codigo = String(rawPayload.codigo || "").trim();
      const nombre = String(rawPayload.nombre || "").trim();
      const tipo = normalizeTemporalType(rawPayload.tipo);
      const remuneradaDefault = normalizeBoolean(rawPayload.remunerada_default, "remunerada_default");
      const activo = rawPayload.activo === undefined ? true : normalizeBoolean(rawPayload.activo, "activo");
      const orden = normalizePositiveInteger(rawPayload.orden, "orden");

      if (!codigo) throw createHttpError(400, "codigo es obligatorio");
      if (!nombre) throw createHttpError(400, "nombre es obligatorio");

      try {
        return await repository.createTemporalMotive({
          codigo,
          nombre,
          tipo,
          remuneradaDefault,
          activo,
          orden
        });
      } catch (error) {
        if (error?.code === "23505") {
          throw createHttpError(409, "Ya existe un motivo con ese código para el mismo tipo", error.code);
        }
        throw error;
      }
    },

    async updateTemporalMotive(id, rawPayload = {}) {
      const motiveId = normalizePositiveInteger(id, "id");
      const updates = {};

      if (rawPayload.codigo !== undefined) {
        updates.codigo = String(rawPayload.codigo || "").trim();
        if (!updates.codigo) throw createHttpError(400, "codigo es obligatorio");
      }
      if (rawPayload.nombre !== undefined) {
        updates.nombre = String(rawPayload.nombre || "").trim();
        if (!updates.nombre) throw createHttpError(400, "nombre es obligatorio");
      }
      if (rawPayload.tipo !== undefined) {
        updates.tipo = normalizeTemporalType(rawPayload.tipo);
      }
      if (rawPayload.remunerada_default !== undefined) {
        updates.remuneradaDefault = normalizeBoolean(rawPayload.remunerada_default, "remunerada_default");
      }
      if (rawPayload.activo !== undefined) {
        updates.activo = normalizeBoolean(rawPayload.activo, "activo");
      }
      if (rawPayload.orden !== undefined) {
        updates.orden = normalizePositiveInteger(rawPayload.orden, "orden");
      }

      if (Object.keys(updates).length === 0) {
        throw createHttpError(400, "Debes enviar al menos un campo para actualizar");
      }

      try {
        const result = await repository.updateTemporalMotive(motiveId, updates);
        if (!result) {
          throw createHttpError(404, "Motivo temporal no encontrado");
        }
        return result;
      } catch (error) {
        if (error?.code === "23505") {
          throw createHttpError(409, "Ya existe un motivo con ese código para el mismo tipo", error.code);
        }
        throw error;
      }
    },

    async activateTemporalMotive(id) {
      const motiveId = normalizePositiveInteger(id, "id");
      const result = await repository.activateTemporalMotive(motiveId);
      if (!result) throw createHttpError(404, "Motivo temporal no encontrado");
      return result;
    },

    async deactivateTemporalMotive(id) {
      const motiveId = normalizePositiveInteger(id, "id");
      const result = await repository.deactivateTemporalMotive(motiveId);
      if (!result) throw createHttpError(404, "Motivo temporal no encontrado");
      return result;
    }
  };
}
