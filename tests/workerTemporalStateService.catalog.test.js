import test from "node:test";
import assert from "node:assert/strict";
import { createTemporalMotiveCatalogRepository } from "../repositories/temporalMotiveCatalogRepository.js";
import { createWorkerTemporalStateService } from "../services/workerTemporalStateService.js";

function createRepositoryStub(overrides = {}) {
  return {
    findWorkerById: async () => ({ id: 1, nombre: "Operador Test", activo: true, empresa_id: 1 }),
    hasOverlappingTemporalState: async () => false,
    createTemporalState: async () => null,
    ...overrides
  };
}

function createMotiveRepositoryStub(overrides = {}) {
  return {
    findActiveTemporalMotiveById: async () => null,
    ...overrides
  };
}

test("requires an active catalog motive and defaults remunerada from the motive when omitted", async () => {
  let capturedPayload = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      createTemporalState: async (payload) => {
        capturedPayload = payload;
        return {
          id: 55,
          trabajador_id: payload.workerId,
          tipo: payload.tipo,
          motivo: payload.motivo,
          motivo_id: payload.motivoId,
          remunerada: payload.remunerada,
          fecha_inicio: payload.fechaInicio,
          fecha_fin: payload.fechaFin
        };
      }
    }),
    motiveCatalogRepository: createMotiveRepositoryStub({
      findActiveTemporalMotiveById: async (motiveId) => {
        if (motiveId === 7) {
          return {
            id: 7,
            codigo: "LIC-001",
            nombre: "Licencia no remunerada",
            tipo: "licencia",
            remunerada_default: false,
            activo: true
          };
        }
        return null;
      }
    })
  });

  const result = await service.createTemporalState(1, {
    tipo: "licencia",
    motivo_id: 7,
    fecha_inicio: "2026-06-10",
    fecha_fin: "2026-06-20"
  }, 99);

  assert.equal(capturedPayload.motivoId, 7);
  assert.equal(capturedPayload.remunerada, false);
  assert.equal(capturedPayload.tipo, "licencia");
  assert.equal(result.remunerada, false);
});

test("rejects motive catalog entries whose type does not match the temporal type", async () => {
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub(),
    motiveCatalogRepository: createMotiveRepositoryStub({
      findActiveTemporalMotiveById: async () => ({
        id: 9,
        codigo: "LIC-009",
        nombre: "Licencia especial",
        tipo: "licencia",
        remunerada_default: true,
        activo: true
      })
    })
  });

  await assert.rejects(
    () => service.createTemporalState(1, {
      tipo: "vacaciones",
      motivo_id: 9,
      fecha_inicio: "2026-06-10",
      fecha_fin: "2026-06-20"
    }),
    (error) => error?.status === 400 && /tipo temporal/i.test(error.message)
  );
});

test("rejects inactive catalog motives for new temporal records", async () => {
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub(),
    motiveCatalogRepository: createMotiveRepositoryStub({
      findActiveTemporalMotiveById: async () => null,
      findTemporalMotiveById: async () => ({
        id: 8,
        tipo: "suspension",
        activo: false,
        remunerada_default: true
      })
    })
  });

  await assert.rejects(
    () => service.createTemporalState(1, {
      tipo: "permiso",
      motivo_id: 8,
      remunerada: true,
      fecha_inicio: "2026-06-10",
      fecha_fin: "2026-06-20"
    }),
    (error) => error?.status === 409 && /activo/i.test(error.message)
  );
});

test("uses the production motive repository default lookup when tipo is permiso and motivo_id is omitted", async () => {
  let capturedQuery = null;
  let capturedPayload = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      createTemporalState: async (payload) => {
        capturedPayload = payload;
        return {
          id: 88,
          trabajador_id: payload.workerId,
          tipo: payload.tipo,
          motivo: payload.motivo,
          motivo_id: payload.motivoId,
          remunerada: payload.remunerada,
          fecha_inicio: payload.fechaInicio,
          fecha_fin: payload.fechaFin
        };
      }
    }),
    motiveCatalogRepository: createTemporalMotiveCatalogRepository({
      db: {
        query: async (sql, params) => {
          capturedQuery = { sql, params };
          return {
            rows: [
              {
                id: 44,
                codigo: "PER-DEF",
                nombre: "Permiso default",
                tipo: "permiso",
                remunerada_default: true,
                activo: true,
                orden: 1
              }
            ]
          };
        }
      }
    })
  });

  const result = await service.createTemporalState(1, {
    tipo: "permiso",
    motivo: "Permiso personal",
    fecha_inicio: "2026-06-10",
    fecha_fin: "2026-06-12"
  }, 99);

  assert.equal(capturedQuery.params[0], "permiso");
  assert.equal(capturedPayload.remunerada, true);
  assert.equal(capturedPayload.tipo, "permiso");
  assert.equal(result.remunerada, true);
});

test("preserves a non-remunerated catalog default when the production default lookup resolves licencia", async () => {
  let capturedPayload = null;
  let defaultLookupType = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      createTemporalState: async (payload) => {
        capturedPayload = payload;
        return {
          id: 89,
          trabajador_id: payload.workerId,
          tipo: payload.tipo,
          motivo: payload.motivo,
          motivo_id: payload.motivoId,
          remunerada: payload.remunerada,
          fecha_inicio: payload.fechaInicio,
          fecha_fin: payload.fechaFin
        };
      }
    }),
    motiveCatalogRepository: createMotiveRepositoryStub({
      findDefaultTemporalMotiveByTipo: async (tipo) => {
        defaultLookupType = tipo;
        return {
          id: 45,
          codigo: "LIC-DEF",
          nombre: "Licencia sin remuneración",
          tipo: "licencia",
          remunerada_default: false,
          activo: true,
          orden: 1
        };
      }
    })
  });

  const result = await service.createTemporalState(1, {
    tipo: "licencia",
    motivo: "Licencia particular",
    fecha_inicio: "2026-06-10",
    fecha_fin: "2026-06-12"
  }, 99);

  assert.equal(defaultLookupType, "licencia");
  assert.equal(capturedPayload.remunerada, false);
  assert.equal(capturedPayload.tipo, "licencia");
  assert.equal(result.remunerada, false);
});
