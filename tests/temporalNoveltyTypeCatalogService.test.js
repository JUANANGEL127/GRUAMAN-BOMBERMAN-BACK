import test from "node:test";
import assert from "node:assert/strict";
import { createTemporalMotiveCatalogService } from "../services/temporalMotiveCatalogService.js";

function createRepositoryStub(overrides = {}) {
  return {
    createTemporalMotive: async () => null,
    ...overrides
  };
}

test("accepts all canonical novelty types", async () => {
  const acceptedTypes = [
    "vacaciones",
    "permiso",
    "sancion",
    "incapacidad_at",
    "incapacidad_general",
    "licencia"
  ];

  const seenTypes = [];
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub({
      createTemporalMotive: async (payload) => {
        seenTypes.push(payload.tipo);
        return { id: seenTypes.length, ...payload, remunerada_default: payload.remuneradaDefault };
      }
    })
  });

  for (const tipo of acceptedTypes) {
    const result = await service.createTemporalMotive({
      codigo: `COD-${tipo}`,
      nombre: `Nombre ${tipo}`,
      tipo,
      remunerada_default: true
    });

    assert.equal(result.tipo, tipo);
    assert.equal(result.remunerada_default, true);
  }

  assert.deepEqual(seenTypes, acceptedTypes);
});

test("rejects unsupported novelty types", async () => {
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub()
  });

  await assert.rejects(
    () => service.createTemporalMotive({
      codigo: "BAD-01",
      nombre: "Tipo inválido",
      tipo: "suspension",
      remunerada_default: false
    }),
    (error) => error?.status === 400 && /tipo/i.test(error.message)
  );
});

test("preserves remunerada_default through the service and repository payload", async () => {
  let capturedPayload = null;
  const service = createTemporalMotiveCatalogService({
    repository: createRepositoryStub({
      createTemporalMotive: async (payload) => {
        capturedPayload = payload;
        return { id: 77, ...payload, remunerada_default: payload.remuneradaDefault };
      }
    })
  });

  const result = await service.createTemporalMotive({
    codigo: "PER-01",
    nombre: "Permiso con snapshot",
    tipo: "permiso",
    remunerada_default: false,
    orden: 4
  });

  assert.equal(capturedPayload.remuneradaDefault, false);
  assert.equal(result.remunerada_default, false);
});
