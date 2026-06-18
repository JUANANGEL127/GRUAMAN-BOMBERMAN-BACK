import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerTemporalStateService } from "../services/workerTemporalStateService.js";

function createRepositoryStub(overrides = {}) {
  return {
    findWorkerById: async () => ({ id: 1, nombre: "Operador Test", activo: true, empresa_id: 1 }),
    hasOverlappingTemporalState: async () => false,
    createTemporalState: async () => null,
    findTemporalStateById: async () => null,
    anularTemporalState: async () => null,
    ...overrides
  };
}

function createMotiveRepositoryStub(overrides = {}) {
  return {
    findActiveTemporalMotiveById: async () => null,
    findDefaultTemporalMotiveByTipo: async () => null,
    ...overrides
  };
}

test("creates a novelty with free-text motivo and applies the type default remuneration when omitted", async () => {
  let capturedPayload = null;
  let defaultTypeSeen = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      createTemporalState: async (payload) => {
        capturedPayload = payload;
        return { id: 55, ...payload };
      }
    }),
    motiveCatalogRepository: createMotiveRepositoryStub({
      findDefaultTemporalMotiveByTipo: async (tipo) => {
        defaultTypeSeen = tipo;
        return tipo === "licencia" ? { tipo, remunerada_default: false } : null;
      }
    })
  });

  const result = await service.createTemporalState(1, {
    tipo: "licencia",
    motivo: "Permiso médico sin catálogo",
    fecha_inicio: "2026-06-10",
    fecha_fin: "2026-06-12"
  }, 99);

  assert.equal(defaultTypeSeen, "licencia");
  assert.equal(capturedPayload.motivo, "Permiso médico sin catálogo");
  assert.equal(capturedPayload.tipo, "licencia");
  assert.equal(capturedPayload.remunerada, false);
  assert.equal(result.remunerada, false);
});

test("soft-cancels a novelty without hard deleting it", async () => {
  let cancelPayload = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findTemporalStateById: async () => ({
        id: 21,
        trabajador_id: 1,
        fecha_inicio: "2026-06-10",
        fecha_fin: null,
        anulado_at: null
      }),
      anularTemporalState: async (recordId, payload) => {
        cancelPayload = { recordId, payload };
        return {
          id: recordId,
          trabajador_id: 1,
          anulado_at: payload.anuladoAt,
          anulado_por: payload.anuladoBy,
          motivo_anulacion: payload.anuladoMotivo
        };
      }
    })
  });

  const result = await service.anularTemporalState(1, 21, {
    motivo_anulacion: "Error de carga"
  }, 77);

  assert.equal(cancelPayload.recordId, 21);
  assert.equal(cancelPayload.payload.anuladoBy, 77);
  assert.equal(cancelPayload.payload.anuladoMotivo, "Error de carga");
  assert.equal(result.anulado_por, 77);
  assert.equal(result.motivo_anulacion, "Error de carga");
});

test("closes a novelty without reusing fecha_fin as the closed status", async () => {
  let closePayload = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findTemporalStateById: async () => ({
        id: 22,
        trabajador_id: 1,
        fecha_inicio: "2026-06-10",
        fecha_fin: "2026-06-20",
        cerrado_at: null
      }),
      closeTemporalState: async (recordId, payload) => {
        closePayload = { recordId, payload };
        return {
          id: recordId,
          trabajador_id: 1,
          fecha_inicio: "2026-06-10",
          fecha_fin: "2026-06-20",
          cerrado_at: payload.cerradoAt,
          cerrado_by: payload.cerradoBy
        };
      }
    })
  });

  const result = await service.closeTemporalState(1, 22, {}, 88);

  assert.equal(closePayload.recordId, 22);
  assert.equal(closePayload.payload.cerradoBy, 88);
  assert.match(closePayload.payload.cerradoAt, /T/);
  assert.equal(result.cerrado_by, 88);
  assert.match(result.cerrado_at, /T/);
});

test("refuses to close an already closed novelty", async () => {
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findTemporalStateById: async () => ({
        id: 23,
        trabajador_id: 1,
        fecha_inicio: "2026-06-10",
        fecha_fin: "2026-06-20",
        cerrado_at: "2026-06-18T10:00:00.000Z"
      })
    })
  });

  await assert.rejects(
    () => service.closeTemporalState(1, 23, {}, 88),
    (error) => error.status === 409 && /ya fue cerrado/i.test(error.message)
  );
});

test("closes a novelty even when fecha_fin already exists as the business period end", async () => {
  let closePayload = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findTemporalStateById: async () => ({
        id: 32,
        trabajador_id: 1,
        fecha_inicio: "2026-06-10",
        fecha_fin: "2026-06-20",
        cerrado_at: null,
        anulado_at: null
      }),
      closeTemporalState: async (recordId, payload) => {
        closePayload = { recordId, payload };
        return {
          id: recordId,
          trabajador_id: 1,
          fecha_inicio: "2026-06-10",
          fecha_fin: "2026-06-20",
          cerrado_at: payload.cerradoAt,
          cerrado_by: payload.cerradoBy
        };
      }
    })
  });

  const result = await service.closeTemporalState(1, 32, {}, 77);

  assert.equal(closePayload.recordId, 32);
  assert.equal(closePayload.payload.cerradoBy, 77);
  assert.match(closePayload.payload.cerradoAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal("fechaFin" in closePayload.payload, false);
  assert.equal(result.fecha_fin, "2026-06-20");
  assert.equal(result.cerrado_by, 77);
  assert.match(result.cerrado_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("active novelty lookups ignore anulled novelties", async () => {
  let currentCall = null;
  let listCall = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findCurrentTemporalStateByWorkerIdAtCutoff: async (workerId, cutoffDate) => {
        currentCall = { workerId, cutoffDate };
        return null;
      },
      findNextTemporalStateByWorkerId: async () => null,
      listTemporalStatesByWorkerIdAtCutoff: async (workerId, cutoffDate) => {
        listCall = { workerId, cutoffDate };
        return [];
      }
    })
  });

  const result = await service.getWorkerTemporalState(1, "2026-06-17");

  assert.equal(currentCall.cutoffDate, "2026-06-17");
  assert.equal(listCall.cutoffDate, "2026-06-17");
  assert.equal(result.vigente_hoy, false);
  assert.equal(result.excluye_indicador_central, false);
});

test("uses the cutoff-aware scheduled novelty lookup when resolving worker temporal state", async () => {
  let nextCall = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findCurrentTemporalStateByWorkerIdAtCutoff: async () => null,
      findNextTemporalStateByWorkerIdAtCutoff: async (workerId, cutoffDate) => {
        nextCall = { workerId, cutoffDate };
        return null;
      },
      listTemporalStatesByWorkerIdAtCutoff: async () => []
    })
  });

  await service.getWorkerTemporalState(1, "2026-06-17");

  assert.deepEqual(nextCall, { workerId: 1, cutoffDate: "2026-06-17" });
});

test("returns the full history timeline from the non-cutoff query while keeping current and next lookups cutoff-aware", async () => {
  let currentCall = null;
  let nextCall = null;
  let historyCall = null;
  const service = createWorkerTemporalStateService({
    repository: createRepositoryStub({
      findCurrentTemporalStateByWorkerIdAtCutoff: async (workerId, cutoffDate) => {
        currentCall = { workerId, cutoffDate };
        return {
          id: 31,
          trabajador_id: workerId,
          fecha_inicio: "2026-06-12",
          fecha_fin: null
        };
      },
      findNextTemporalStateByWorkerIdAtCutoff: async (workerId, cutoffDate) => {
        nextCall = { workerId, cutoffDate };
        return {
          id: 41,
          trabajador_id: workerId,
          fecha_inicio: "2026-06-21",
          fecha_fin: null
        };
      },
      listTemporalStatesByWorkerIdHistory: async (workerId) => {
        historyCall = workerId;
        return [
          {
            id: 61,
            trabajador_id: workerId,
            fecha_inicio: "2026-06-01",
            fecha_fin: "2026-06-10",
            anulado_at: null
          },
          {
            id: 62,
            trabajador_id: workerId,
            fecha_inicio: "2026-06-11",
            fecha_fin: "2026-06-12",
            anulado_at: "2026-06-13T08:00:00.000Z"
          }
        ];
      },
      listTemporalStatesByWorkerIdAtCutoff: async () => {
        throw new Error("detail timeline must not use the cutoff history query");
      }
    })
  });

  const result = await service.getWorkerTemporalState(1, "2026-06-17");

  assert.deepEqual(currentCall, { workerId: 1, cutoffDate: "2026-06-17" });
  assert.deepEqual(nextCall, { workerId: 1, cutoffDate: "2026-06-17" });
  assert.equal(historyCall, 1);
  assert.deepEqual(result.historial.map(({ id, fecha_fin, anulado_at }) => ({ id, fecha_fin, anulado_at })), [
    { id: 61, fecha_fin: "2026-06-10", anulado_at: null },
    { id: 62, fecha_fin: "2026-06-12", anulado_at: "2026-06-13T08:00:00.000Z" }
  ]);
});
