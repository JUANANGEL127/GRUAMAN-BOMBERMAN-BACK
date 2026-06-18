import test from "node:test";
import assert from "node:assert/strict";
import { createTemporalMotiveCatalogService } from "../services/temporalMotiveCatalogService.js";

function createRepositoryStub(overrides = {}) {
  return {
    createTemporalMotive: async () => null,
    findTemporalMotiveByTipoAndCodigo: async () => null,
    ...overrides
  };
}

test("creates a motive catalog entry and defaults active to true", async () => {
  let capturedPayload = null;
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub({
      createTemporalMotive: async (payload) => {
        capturedPayload = payload;
        return { id: 11, ...payload };
      }
    })
  });

  const result = await service.createTemporalMotive({
    codigo: "SAN-01",
    nombre: "Sanción disciplinaria",
    tipo: "sancion",
    remunerada_default: false,
    orden: 7
  });

  assert.equal(capturedPayload.activo, true);
  assert.equal(capturedPayload.codigo, "SAN-01");
  assert.equal(capturedPayload.tipo, "sancion");
  assert.equal(result.id, 11);
  assert.equal(result.activo, true);
});

test("preserves explicit inactive state and trims incoming fields", async () => {
  let capturedPayload = null;
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub({
      createTemporalMotive: async (payload) => {
        capturedPayload = payload;
        return { id: 12, ...payload };
      }
    })
  });

  const result = await service.createTemporalMotive({
    codigo: "  LIC-02  ",
    nombre: "  Licencia médica  ",
    tipo: "  licencia  ",
    remunerada_default: "true",
    activo: false,
    orden: "9"
  });

  assert.equal(capturedPayload.codigo, "LIC-02");
  assert.equal(capturedPayload.nombre, "Licencia médica");
  assert.equal(capturedPayload.tipo, "licencia");
  assert.equal(capturedPayload.activo, false);
  assert.equal(capturedPayload.orden, 9);
  assert.equal(result.activo, false);
});

test("rejects unsupported motive type", async () => {
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub()
  });

  await assert.rejects(
    () => service.createTemporalMotive({
      codigo: "VAC-01",
      nombre: "Vacaciones",
      tipo: "suspension",
      remunerada_default: true
    }),
    (error) => error?.status === 400 && /tipo/i.test(error.message)
  );
});

test("rejects duplicate codigo within the same tipo", async () => {
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub({
      createTemporalMotive: async () => {
        const error = new Error("duplicate key value violates unique constraint");
        error.code = "23505";
        throw error;
      }
    })
  });

  await assert.rejects(
    () => service.createTemporalMotive({
      codigo: "SAN-01",
      nombre: "Sanción disciplinaria",
      tipo: "sancion",
      remunerada_default: false
    }),
    (error) => error?.status === 409
  );
});
